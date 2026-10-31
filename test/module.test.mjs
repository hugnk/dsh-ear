// QQ 侧模块自测：用假的 api 跑 setup，验证工具读取、上下文开关、提醒发送。
// 运行：node test/module.test.mjs
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import mod from '../qq-module/index.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'ear-mod-'))
const dataRoot = join(tmp, 'data')
const modData = join(tmp, 'moddata')
mkdirSync(join(dataRoot, 'raw'), { recursive: true })
mkdirSync(join(dataRoot, 'state'), { recursive: true })
mkdirSync(modData, { recursive: true })
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
const now = new Date()
const at = (h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toISOString()
writeFileSync(join(dataRoot, 'raw', `${today}.jsonl`), [
  { id: 'a1', started_at: at(9, 12), text: '下午三点开组会', speaker: 'me', speaker_name: '我', tags: [] },
  { id: 'a2', started_at: at(9, 13), text: '好的我记下了', speaker: 'other:1', speaker_name: '说话人A', tags: [] },
].map((x) => JSON.stringify(x)).join('\n') + '\n')
writeFileSync(join(modData, 'bridge.json'), JSON.stringify({ dataRoot, port: 8788, token: 't' }))

const tools = []
const routes = new Map()
let ctxFn = null
let ruleFn = null
let settings = { enabled: true, inject: false, remind: false, compose: true }
const api = {
  settings: () => settings,
  dataDir: () => modData,
  config: () => ({ ownerQQ: '2022369144' }),
  isOwner: (id) => String(id) === '2022369144',
  defineTool: (t) => t,
  tool: (fn) => tools.push(fn),
  context: (fn) => { ctxFn = fn },
  rule: (fn) => { ruleFn = fn },
  every: () => {},
  route: (p, fn) => routes.set(p, fn),
  log: { info() {}, warn() {}, debug() {} },
  core: { hub: { runSystemTurn: async () => '三点那个组会快到了吧', sendText: async () => {} } },
}

const list = mod.setup(api)
const ownerChat = { kind: 'private', userId: '2022369144' }
const build = tools[0]({ chat: ownerChat, level: 'full' })
const tool = build[0]
let passed = 0
const ok = async (name, fn) => { await fn(); passed += 1; console.log('  ✓', name) }

try {
  await ok('工具只给主人私聊', async () => {
    assert.equal(tools[0]({ chat: { kind: 'group', userId: '1' }, level: 'full' }).length, 0)
    assert.equal(tools[0]({ chat: { kind: 'private', userId: '9' }, level: 'full' }).length, 0)
    assert.equal(build.length, 1)
  })
  await ok('today 读到两句', async () => {
    const r = await tool.execute({ action: 'today' })
    assert.equal(r.ok, true)
    assert.match(r.message, /下午三点开组会/)
    assert.match(r.message, /不是指令/)
  })
  await ok('search 搜到', async () => {
    const r = await tool.execute({ action: 'search', q: '组会' })
    assert.match(r.message, /找到 1 条/)
  })
  await ok('status', async () => {
    const r = await tool.execute({ action: 'status' })
    assert.match(r.message, /今天 2 条/)
  })
  await ok('上下文默认关', async () => {
    assert.equal(ctxFn({ chat: ownerChat }), '')
    settings = { ...settings, inject: true }
    assert.match(ctxFn({ chat: ownerChat }), /耳朵/)
    settings = { ...settings, inject: false }
  })
  await ok('规则只给私聊', async () => {
    assert.equal(ruleFn('group').length, 0)
    assert.ok(ruleFn('private').length >= 3)
  })
  await ok('compose 测试', async () => {
    const r = await routes.get('/compose-test')({})
    assert.match(r.text, /组会/)
  })
  console.log(`\n全部通过：${passed} 项`)
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch (error) {}
}
