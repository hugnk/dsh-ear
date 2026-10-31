// 存储：raw/<日期>.jsonl 原文、state/seen.json 去重、state/notices.json 提醒、
// quarantine/ 坏包、logs/ 接收日志（不写正文）。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite, readJson } from './util.js'
import { localDate } from './protocol.js'

const DAY = 86_400_000

export function createStore(dataRoot) {
  const dirs = {
    raw: join(dataRoot, 'raw'),
    days: join(dataRoot, 'days'),
    state: join(dataRoot, 'state'),
    quarantine: join(dataRoot, 'quarantine'),
    logs: join(dataRoot, 'logs'),
  }
  for (const d of Object.values(dirs)) { try { mkdirSync(d, { recursive: true }) } catch (error) {} }

  const seenFile = join(dirs.state, 'seen.json')
  const noticesFile = join(dirs.state, 'notices.json')
  let seen = readJson(seenFile, null) || { batches: {}, items: {} }

  function saveSeen() {
    // 防无限增长：只保留最近 60 天见过的
    const cutoff = Date.now() - 60 * DAY
    for (const [k, at] of Object.entries(seen.items)) if (Number(at) < cutoff) delete seen.items[k]
    for (const [k, at] of Object.entries(seen.batches)) if (Number(at) < cutoff) delete seen.batches[k]
    try { atomicWrite(seenFile, JSON.stringify(seen)) } catch (error) {}
  }

  function seenBatch(id) { return Boolean(id && seen.batches[id]) }
  function markBatch(id) { if (id) { seen.batches[id] = Date.now(); saveSeen() } }
  function filterNew(items) {
    const out = []
    for (const it of items) {
      if (seen.items[it.id]) continue
      seen.items[it.id] = Date.now()
      out.push(it)
    }
    if (out.length) saveSeen()
    return out
  }

  function appendItems(items) {
    const byDate = new Map()
    for (const it of items) {
      const d = it.date || localDate(new Date(it.started_at))
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d).push(it)
    }
    for (const [d, list] of byDate) {
      const file = join(dirs.raw, `${d}.jsonl`)
      const lines = list.map((it) => JSON.stringify(it)).join('\n') + '\n'
      try { appendFileSync(file, lines, 'utf8') } catch (error) { throw error }
    }
  }

  function readRaw(date) {
    try {
      return readFileSync(join(dirs.raw, `${date}.jsonl`), 'utf8')
        .split('\n').filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l) } catch (error) { return null } })
        .filter(Boolean)
        .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    } catch (error) { return [] }
  }

  function readDay(date) {
    try { return readFileSync(join(dirs.days, `${date}.md`), 'utf8') } catch (error) { return '' }
  }

  function days() {
    try { return readdirSync(dirs.raw).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).sort() } catch (error) { return [] }
  }

  function prune(retentionDays) {
    const cutoff = localDate(new Date(Date.now() - Math.max(1, retentionDays) * DAY))
    let removed = 0
    for (const d of days()) {
      if (d >= cutoff) continue
      try { unlinkSync(join(dirs.raw, `${d}.jsonl`)); removed += 1 } catch (error) {}
    }
    return removed
  }

  function quarantine(text, info) {
    const name = `bad-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(16).slice(2, 6)}.txt`
    try { writeFileSync(join(dirs.quarantine, name), `${JSON.stringify(info)}\n\n${String(text).slice(0, 200_000)}`, 'utf8') } catch (error) {}
  }

  function logEvent(kind, data) {
    const date = localDate(new Date())
    const line = JSON.stringify({ at: new Date().toISOString(), kind, ...data })
    try { appendFileSync(join(dirs.logs, `${date}.log`), line + '\n', 'utf8') } catch (error) {}
  }

  function addNotices(list) {
    if (!list || !list.length) return 0
    const cur = readJson(noticesFile, null) || []
    const have = new Set(cur.map((n) => n.id))
    const next = [...cur, ...list.filter((n) => n && !have.has(n.id))]
    try { atomicWrite(noticesFile, JSON.stringify(next.slice(-500))) } catch (error) { return 0 }
    return list.length
  }

  function readNotices() {
    return readJson(noticesFile, []) || []
  }

  function stats() {
    const list = days()
    let total = 0
    for (const d of list) total += readRaw(d).length
    const today = readRaw(localDate(new Date())).length
    return { days: list.length, total, today }
  }

  return {
    root: dataRoot,
    dirs,
    appendItems,
    filterNew,
    seenBatch,
    markBatch,
    readRaw,
    readDay,
    days,
    prune,
    quarantine,
    logEvent,
    addNotices,
    readNotices,
    stats,
  }
}
