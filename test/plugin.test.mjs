// 插件宿主自测：用假的 ctx 跑 apply()，验证配置、监听、命令、接口、退出清理。
// 运行：node test/plugin.test.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'

const tmp = mkdtempSync(join(tmpdir(), 'ear-plugin-'))
process.env.DSH_HOME = join(tmp, '.dsh')
const cwd0 = process.cwd()
process.chdir(tmp)

const { apply } = await import('../index.js')

const disposers = []
let registeredCommand = null
const routes = new Map()
const fakeCtx = {
  logger: { info() {}, warn() {}, error() {} },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d) },
  inject: (deps, fn) => fn({
    effect: (fn2, label) => { const d = fn2(); if (typeof d === 'function') disposers.push(d) },
    commands: { register: (c) => { registeredCommand = c; return () => {} } },
    webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
  }),
}

let passed = 0
const ok = async (name, fn) => { await fn(); passed += 1; console.log('  ✓', name) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  apply(fakeCtx, {})
  await wait(600)

  const status = await import('../src/config.js').then((m) => m.loadConfig(join(tmp, '录音豆-耳朵')))
  ok('生成了 token', () => assert.equal(status.token.length, 64))
  ok('默认端口 8788', () => assert.equal(status.port, 8788))

  const health = await fetch('http://127.0.0.1:8788/health').then((r) => r.json())
  ok('服务器在监听并回 health', () => assert.equal(health.ok, true))

  const bad = await fetch('http://127.0.0.1:8788/ingest', { method: 'POST', body: '{}' })
  ok('没 token → 401', () => assert.equal(bad.status, 401))

  const good = await fetch('http://127.0.0.1:8788/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${status.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ batch_id: 'p1', items: [{ id: 'p1-1', started_at: new Date().toISOString(), text: '下午三点开组会', speaker: 'me' }] }),
  })
  const body = await good.json()
  ok('带 token → 200 且收下', () => { assert.equal(good.status, 200); assert.equal(body.stored, 1) })

  const dup = await fetch('http://127.0.0.1:8788/ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${status.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ batch_id: 'p1', items: [{ id: 'p1-1', started_at: new Date().toISOString(), text: '下午三点开组会', speaker: 'me' }] }),
  }).then((r) => r.json())
  ok('同一批重发 → 去重', () => assert.equal(dup.duplicate, true))

  ok('注册了 /ear 命令', () => assert.equal(registeredCommand && registeredCommand.name, 'ear'))
  const cmd = await registeredCommand.handler({ rawInput: '' })
  ok('命令能显示地址和 token', () => { assert.match(cmd.text, /8788/); assert.ok(cmd.text.includes(status.token)) })
  const on = await registeredCommand.handler({ rawInput: 'remind off' })
  ok('命令能关提醒', () => assert.match(on.text, /关掉/))

  ok('注册了状态接口', () => assert.ok(routes.has('/ear/api/status')))

  for (const d of disposers.reverse()) { try { d() } catch (error) {} }
  await wait(200)
  const closed = await fetch('http://127.0.0.1:8788/health').then(() => false).catch(() => true)
  ok('退出后端口关闭', () => assert.equal(closed, true))

  console.log(`\n全部通过：${passed} 项`)
} finally {
  try { process.chdir(cwd0) } catch (error) {}
  try { rmSync(tmp, { recursive: true, force: true }) } catch (error) {}
}
