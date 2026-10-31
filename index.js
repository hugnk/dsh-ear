// 大肥鱼的耳朵 · DSH 插件宿主。
// 自己监听 0.0.0.0:<port> 收录音豆的转写，存档、去重、抽提醒；
// 再往 aurabot 里放一个很小的 QQ 侧模块（工具 + 可选上下文 + 到点提醒）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'
import { homedir } from 'node:os'
import { loadConfig, saveConfig, normalizeConfig } from './src/config.js'
import { createStore } from './src/store.js'
import { createServer } from './src/server.js'
import { normalizeBatch, localDate } from './src/protocol.js'
import { extractReminders } from './src/reminders.js'
import { installQqModule } from './src/bridge.js'

export const name = 'ear'
export const inject = ['webServer']

const VERSION = '0.1.0'
const DAY = 86_400_000

function readDefaultWorkspace() {
  try {
    const home = process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), '.dsh')
    const file = join(home, 'storages', 'workspace.json')
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const id = json?.global?.defaultWorkspaceId
    const ws = id ? json?.tables?.workspaces?.[id] : null
    return ws && ws.path ? ws.path : ''
  } catch (error) { return '' }
}

function resolveDataRoot(config) {
  const explicit = String((config && config.dataRoot) || '').trim()
  if (explicit) return explicit
  const ws = readDefaultWorkspace()
  if (ws) return join(ws, '录音豆-耳朵')
  return join(process.cwd(), '录音豆-耳朵')
}

function lanAddresses() {
  const out = []
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const a of list || []) {
      if (!a || a.internal) continue
      if (a.family !== 'IPv4' && a.family !== 4) continue
      out.push({ iface, address: a.address })
    }
  }
  const score = (ip) => (/^192\.168\./.test(ip) ? 3 : /^10\./.test(ip) ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 1)
  return out.sort((a, b) => score(b.address) - score(a.address))
}

export function apply(ctx, config = {}) {
  const dataRoot = resolveDataRoot(config)
  let cfg = loadConfig(dataRoot)
  const logger = ctx.logger || console
  const log = (kind, data = {}) => { try { logger.info?.(`[ear] ${kind} ${JSON.stringify(data)}`) } catch (error) {} }
  const store = createStore(dataRoot)
  const server = createServer({
    getConfig: () => cfg,
    ingest: (bodyText, info) => ingest(bodyText, info),
    stats: () => store.stats(),
    log,
  })

  const moduleSource = (() => {
    try { return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'qq-module', 'index.mjs'), 'utf8') } catch (error) { return '' }
  })()

  function ingest(bodyText, { ip = '', cfg: current = cfg } = {}) {
    let body
    try {
      body = JSON.parse(bodyText)
    } catch (error) {
      store.quarantine(bodyText, { reason: 'JSON 解析失败', ip })
      store.logEvent('ingest', { result: 'quarantine', ip, reason: 'json' })
      return { code: 200, payload: { ok: true, quarantined: true, stored: 0 } }
    }
    const batch = normalizeBatch(body, { ownerSpeaker: current.owner_speaker, now: new Date() })
    if (batch.kind === 'summary') {
      store.logEvent('ingest', { result: 'summary_ignored', ip })
      return { code: 200, payload: { ok: true, ignored: 'daily_summary', stored: 0 } }
    }
    if (batch.kind === 'invalid') {
      store.quarantine(bodyText, { reason: batch.reason, batch_id: batch.batchId, ip })
      store.logEvent('ingest', { result: 'quarantine', ip, reason: batch.reason })
      return { code: 200, payload: { ok: true, quarantined: true, stored: 0 } }
    }
    if (batch.test) {
      store.logEvent('ingest', { result: 'test', ip, batch_id: batch.batchId })
      return { code: 200, payload: { ok: true, test: true, stored: 0 } }
    }
    if (batch.batchId && store.seenBatch(batch.batchId)) {
      store.logEvent('ingest', { result: 'dup_batch', ip, batch_id: batch.batchId })
      return { code: 200, payload: { ok: true, duplicate: true, stored: 0 } }
    }
    const fresh = store.filterNew(batch.items)
    let stored = 0
    if (fresh.length) {
      store.appendItems(fresh)
      stored = fresh.length
    }
    store.markBatch(batch.batchId)
    let notices = 0
    if (current.reminders) {
      const list = extractReminders(fresh, { ownerSpeaker: current.owner_speaker, now: new Date() })
      notices = store.addNotices(list)
    }
    store.logEvent('ingest', { result: 'ok', ip, batch_id: batch.batchId, stored, notices })
    return { code: 200, payload: { ok: true, stored, duplicates: batch.items.length - stored, notices } }
  }

  function bridgePayload() {
    return { dataRoot, port: server.port, token: cfg.token, version: VERSION, host: cfg.host }
  }

  function ensureQqModule() {
    if (!cfg.install_qq_module || !moduleSource) return
    const r = installQqModule({ source: moduleSource, bridge: bridgePayload(), log })
    if (!r.ok) log('bridge', { result: 'skipped', reason: r.reason })
  }

  ;(async () => {
    try {
      const r = await server.start(cfg)
      if (r.shifted && r.port !== cfg.port) {
        cfg = saveConfig(dataRoot, { ...cfg, port: r.port })
        log('config', { result: 'port_changed', port: r.port })
      }
    } catch (error) {
      log('server', { result: 'start_failed', message: String(error && error.message) })
    }
    ensureQqModule()
  })()

  // 端口没绑上就每分钟重试
  const retry = setInterval(() => {
    if (!server.listening) {
      server.start(cfg).then((r) => {
        if (r && r.port !== cfg.port) cfg = saveConfig(dataRoot, { ...cfg, port: r.port })
        ensureQqModule()
      }).catch(() => {})
    }
  }, 60_000)
  retry.unref?.()

  // 每天清理一次过期原文
  let lastPrune = 0
  const pruneTimer = setInterval(() => {
    if (Date.now() - lastPrune < DAY) return
    lastPrune = Date.now()
    try { store.prune(cfg.raw_retention_days) } catch (error) {}
  }, 6 * 3600_000)
  pruneTimer.unref?.()
  try { store.prune(cfg.raw_retention_days) } catch (error) {}

  // 斜杠命令 /ear
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['commands'], (c) => {
        c.effect(() => c.commands.register({
          name: 'ear',
          description: '大肥鱼的耳朵：查看接收地址、token、今天收了多少条',
          input: { hint: '[status|url|token|remind on|off]' },
          handler: async ({ rawInput }) => {
            const arg = String(rawInput || '').trim()
            if (arg === 'token') return { kind: 'success', text: cfg.token }
            if (arg === 'url') {
              const ip = lanAddresses()[0]?.address || '127.0.0.1'
              return { kind: 'success', text: `手机填：http://${ip}:${server.port || cfg.port}/ingest` }
            }
            if (/^remind\s+(on|off)$/i.test(arg)) {
              const on = /on$/i.test(arg)
              cfg = saveConfig(dataRoot, { ...cfg, reminders: on })
              return { kind: 'success', text: `到点提醒已${on ? '打开' : '关掉'}` }
            }
            const s = store.stats()
            const ips = lanAddresses()
            return {
              kind: 'success',
              text: [
                `耳朵 v${VERSION} · ${server.listening ? `正在监听 ${server.port}` : '没在监听'}`,
                ...(ips.length ? ips.map((x) => `手机填：http://${x.address}:${server.port || cfg.port}/ingest（${x.iface}）`) : ['没找到局域网地址']),
                `token：${cfg.token}`,
                `数据目录：${dataRoot}`,
                `今天 ${s.today} 条 · 共 ${s.total} 条 · 到点提醒 ${cfg.reminders ? '开' : '关'}`,
              ].join('\n'),
            }
          },
        }), 'ear: 命令')
      })
    }
  } catch (error) { log('command', { result: 'failed', message: String(error && error.message) }) }

  // 本地面板接口（给以后的网页用；现在也可以 curl 看）
  try {
    ctx.inject(['webServer'], (c) => {
      const route = (path, handler) => c.effect(() => c.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          const body = Buffer.from(JSON.stringify(handler(req)) || '{}', 'utf8')
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' })
          res.end(body)
        },
      }), `ear: ${path}`)
      route('/ear/api/status', () => ({
        ok: true,
        version: VERSION,
        listening: server.listening,
        port: server.port,
        endpoints: lanAddresses().map((x) => ({ iface: x.iface, url: `http://${x.address}:${server.port}/ingest` })),
        stats: store.stats(),
        reminders: cfg.reminders,
        dataRoot,
      }))
    })
  } catch (error) { log('api', { result: 'failed', message: String(error && error.message) }) }

  ctx.effect(() => () => {
    clearInterval(retry)
    clearInterval(pruneTimer)
    try { server.stop() } catch (error) {}
    log('lifecycle', { result: 'stopped' })
  }, 'ear: 收尾')

  log('lifecycle', { result: 'started', dataRoot, port: cfg.port, version: VERSION })
}
