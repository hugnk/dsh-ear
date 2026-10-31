// 离线自测：协议兼容、去重、落盘、提醒抽取、HTTP 服务。
// 运行：node test/offline.test.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import { normalizeBatch } from '../src/protocol.js'
import { createStore } from '../src/store.js'
import { extractReminders, parseTodayTime } from '../src/reminders.js'
import { createServer } from '../src/server.js'

const tmp = mkdtempSync(join(tmpdir(), 'ear-test-'))
let passed = 0
const ok = (name, fn) => { fn(); passed += 1; console.log('  ✓', name) }

try {
  // 1. v1 格式
  const v1 = normalizeBatch({
    protocol: 'luyindou/1',
    batch_id: 'b1',
    items: [
      { id: 'i1', started_at: '2026-10-31T14:37:02+08:00', text: '下午三点开组会', speaker: 'me' },
      { id: 'i2', started_at: '2026-10-31T14:37:05+08:00', text: '好的', speaker: 'other:1', speaker_name: '说话人A' },
    ],
  }, { ownerSpeaker: 'me' })
  ok('v1 解析出两条', () => assert.equal(v1.items.length, 2))
  ok('v1 speaker 保留', () => assert.equal(v1.items[1].speaker, 'other:1'))

  // 2. 旧格式
  const legacy = normalizeBatch({
    items: [
      { id: 'l1', started_at: '2026-10-31T09:00:00+08:00', text: '我', speaker: '我' },
      { id: 'l2', started_at: '2026-10-31T09:00:01+08:00', text: '好', speaker: '说话人A' },
      { id: 'l3', started_at: '2026-10-31T09:00:02+08:00', text: '？', speaker: null },
    ],
  }, { ownerSpeaker: 'me' })
  ok('旧格式 我 → me', () => assert.equal(legacy.items[0].speaker, 'me'))
  ok('旧格式 说话人A → other:1', () => assert.equal(legacy.items[1].speaker, 'other:1'))
  ok('旧格式 null → unknown', () => assert.equal(legacy.items[2].speaker, 'unknown'))

  // 3. 去重 + 落盘
  const store = createStore(tmp)
  const fresh1 = store.filterNew(v1.items)
  ok('第一次全收', () => assert.equal(fresh1.length, 2))
  store.appendItems(fresh1)
  const again = store.filterNew(v1.items)
  ok('第二次全去重', () => assert.equal(again.length, 0))
  ok('落盘按日期', () => assert.equal(store.readRaw(v1.items[0].date).length, 2))

  // 4. 提醒抽取
  const now = new Date('2026-10-31T14:00:00+08:00')
  ok('解析 下午三点', () => {
    const d = parseTodayTime('下午三点开组会', now)
    assert.equal(d.getHours(), 15)
    assert.equal(d.getMinutes(), 0)
  })
  const notices = extractReminders(v1.items, { ownerSpeaker: 'me', now })
  ok('抽出 1 条提醒', () => assert.equal(notices.length, 1))
  ok('提醒 id 稳定', () => assert.equal(notices[0].id, 'r-i1'))
  ok('别人说的不算提醒', () => assert.equal(extractReminders(v1.items, { ownerSpeaker: 'me', now }).some((n) => n.id === 'r-i2'), false))

  // 5. HTTP
  const srv = createServer({
    getConfig: () => ({ token: 'tok', require_token: true }),
    ingest: (text) => {
      const b = normalizeBatch(JSON.parse(text), { ownerSpeaker: 'me' })
      return { code: 200, payload: { ok: true, stored: b.items.length } }
    },
    stats: () => store.stats(),
    log: () => {},
  })
  const { port } = await srv.start({ host: '127.0.0.1', port: 0 })
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
  ok('health 免 token', () => assert.equal(health.ok, true))
  const bad = await fetch(`http://127.0.0.1:${port}/ingest`, { method: 'POST', headers: { authorization: 'Bearer no' }, body: '{}' })
  ok('错 token → 401', () => assert.equal(bad.status, 401))
  const good = await fetch(`http://127.0.0.1:${port}/ingest`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify({ batch_id: 'b1', items: [{ id: 'x', started_at: '2026-10-31T10:00:00+08:00', text: 'hi', speaker: 'me' }] }),
  })
  assert.equal(good.status, 200)
  passed += 1
  console.log('  ✓ 正常 → 200')
  srv.stop()

  console.log(`\n全部通过：${passed} 项`)
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch (error) {}
}
