// 提醒抽取：从主人说的话里找「几点要干什么」。
// 只在同一天内有效（不猜“明天/后天”，避免算错日期）。
const ACTION = /开会|开组会|组会|例会|会议|上课|面试|见面|约|交|发|取|拿|还|借|出发|截止|ddl|deadline|提醒|记得|别忘|药店|医院|快递|聚餐|考试|汇报|答辩|上车|登机|打卡|签到|缴费|还款/
const TIME = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*[点:：]\s*(\d{1,2})?\s*(半|一刻|三刻)?/

const CN = { 零: '0', 〇: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }

/** 把「三点半」这种中文数字换成阿拉伯数字，方便解析。 */
export function normalizeDigits(text) {
  return String(text || '')
    .replace(/十([一二三四五六七八九])/g, (_, d) => '1' + CN[d])
    .replace(/十/g, '10')
    .replace(/[零〇一二两三四五六七八九]/g, (ch) => CN[ch] || ch)
}

function minuteOf(word) {
  if (word === '半') return 30
  if (word === '一刻') return 15
  if (word === '三刻') return 45
  return 0
}

/** 从一句话里解析出今天的 HH:mm，解析不到返回 null。 */
export function parseTodayTime(text, now = new Date()) {
  const m = normalizeDigits(text).match(TIME)
  if (!m) return null
  let h = Number(m[2])
  const mm = m[3] !== undefined ? Number(m[3]) : minuteOf(m[4])
  if (!Number.isFinite(h) || h > 23 || mm > 59) return null
  const part = m[1] || ''
  if ((part === '下午' || part === '傍晚' || part === '晚上') && h < 12) h += 12
  if (part === '中午' && h < 11) h += 12
  const due = new Date(now)
  due.setHours(h, mm, 0, 0)
  return due
}

/**
 * @returns {object[]} notices: {id, kind:'reminder', text, dueAt, createdAt}
 */
export function extractReminders(items, { ownerSpeaker = 'me', now = new Date(), withinHours = 12 } = {}) {
  const out = []
  for (const it of items || []) {
    if (it.speaker !== ownerSpeaker) continue
    const text = String(it.text || '')
    if (!ACTION.test(text)) continue
    const due = parseTodayTime(text, now)
    if (!due) continue
    const delta = due.getTime() - now.getTime()
    if (delta < 60_000 || delta > withinHours * 3_600_000) continue
    out.push({
      id: `r-${it.id}`,
      kind: 'reminder',
      text: String(text).slice(0, 160),
      dueAt: due.getTime(),
      createdAt: now.getTime(),
    })
  }
  return out
}
