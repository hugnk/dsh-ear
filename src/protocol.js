// 录音豆协议：v1 + 旧格式（v0.5 App）都收，统一成 v1 字段。
// 旧格式：没有 protocol；speaker 是 "我"/"说话人A"/null。

const pad = (n) => String(n).padStart(2, '0')

export function localDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toDate(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Date.parse(String(v))
  const d = new Date(n)
  return Number.isNaN(d.getTime()) ? fallback : d
}

const SPEAKER_CN = /^说话人([A-Z])$/

/** 旧格式的 speaker 值 → 稳定标识。 */
export function mapSpeaker(raw, ownerSpeaker) {
  const v = raw === null || raw === undefined ? '' : String(raw).trim()
  const owner = String(ownerSpeaker || 'me')
  if (!v) return { speaker: 'unknown', speaker_name: '' }
  if (v === '我' || v === owner || v === 'me' || v === 'owner') return { speaker: owner, speaker_name: '我' }
  if (v === 'unknown' || v === '未知') return { speaker: 'unknown', speaker_name: '未知' }
  const m = v.match(SPEAKER_CN)
  if (m) return { speaker: `other:${m[1].charCodeAt(0) - 64}`, speaker_name: v }
  if (/^other:\d+$/.test(v)) return { speaker: v, speaker_name: v }
  return { speaker: 'other:1', speaker_name: v }
}

function cleanItem(raw, { ownerSpeaker, fallbackTime }) {
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text ?? raw.content ?? '').trim().slice(0, 500)
  if (!text) return null
  const id = String(raw.id ?? raw.msg_id ?? raw.uuid ?? '').trim()
  if (!id) return null
  const started = toDate(raw.started_at ?? raw.start_time ?? raw.time ?? raw.ts, fallbackTime)
  const ended = toDate(raw.ended_at ?? raw.end_time, started)
  const sp = mapSpeaker(raw.speaker ?? raw.role ?? raw.who, ownerSpeaker)
  const speakerName = String(raw.speaker_name ?? sp.speaker_name ?? '').trim().slice(0, 40)
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).slice(0, 20)).slice(0, 8) : []
  const emotion = raw.emotion ? String(raw.emotion).slice(0, 20) : ''
  return {
    id,
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    text,
    speaker: sp.speaker,
    speaker_name: speakerName || sp.speaker_name,
    tags,
    emotion,
    date: localDate(started),
  }
}

/**
 * @returns {{kind:'ok', batchId:string, items:object[], test:boolean} | {kind:'invalid', reason:string, batchId:string}}
 */
export function normalizeBatch(body, { ownerSpeaker = 'me', now = new Date() } = {}) {
  if (!body || typeof body !== 'object') return { kind: 'invalid', reason: '正文不是 JSON 对象', batchId: '' }
  const batchId = String(body.batch_id ?? body.batchId ?? '').trim()
  if (body.type === 'daily_summary') return { kind: 'summary', batchId, items: [], test: false }
  const list = Array.isArray(body.items) ? body.items : (Array.isArray(body.sentences) ? body.sentences : null)
  if (!list) return { kind: 'invalid', reason: '没有 items 数组', batchId }
  const items = []
  let dropped = 0
  for (const raw of list) {
    const it = cleanItem(raw, { ownerSpeaker, fallbackTime: now })
    if (it) items.push(it); else dropped += 1
  }
  if (!items.length) return { kind: 'invalid', reason: `items 里没有可用的句子（丢掉 ${dropped} 条）`, batchId }
  return { kind: 'ok', batchId, items, test: Boolean(body.test) }
}
