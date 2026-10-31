import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch (error) {}
}

export function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function asBool(v, d) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return d
}

export function asInt(v, d, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return d
  const i = Math.round(n)
  return Math.max(min, Math.min(max, i))
}

export function atomicWrite(file, text) {
  ensureDir(dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text)
  try { renameSync(tmp, file) } catch (error) { writeFileSync(file, text); try { renameSync(tmp, file) } catch {} }
}

export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (error) { return fallback }
}

export function shortHash(text) {
  let h = 2166136261
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function clampText(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
