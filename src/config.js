// 配置：全部存在 <数据目录>/config.json。token 只写文件，不进日志、不发聊天。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { asBool, asInt, atomicWrite, ensureDir, isPlainObject } from './util.js'

export const CONFIG_FILE = 'config.json'

export const DEFAULTS = {
  port: 8788,
  host: '0.0.0.0',
  token: '',
  require_token: true,
  owner_speaker: 'me',
  raw_retention_days: 30,
  others_retention_days: 7,
  lead_minutes: 25,
  reminders: true,
  install_qq_module: true,
}

export function newToken() {
  return randomBytes(32).toString('hex')
}

function padClock(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return ''
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`
}

export function normalizeConfig(input) {
  const raw = isPlainObject(input) ? input : {}
  const out = {}
  out.port = asInt(raw.port, DEFAULTS.port, 1024, 65535)
  out.host = typeof raw.host === 'string' && raw.host.trim() ? raw.host.trim() : DEFAULTS.host
  out.token = typeof raw.token === 'string' ? raw.token.trim() : ''
  if (!out.token) out.token = newToken()
  out.require_token = asBool(raw.require_token, DEFAULTS.require_token)
  out.owner_speaker = typeof raw.owner_speaker === 'string' && raw.owner_speaker.trim() ? raw.owner_speaker.trim() : DEFAULTS.owner_speaker
  out.raw_retention_days = asInt(raw.raw_retention_days, DEFAULTS.raw_retention_days, 1, 3650)
  out.others_retention_days = asInt(raw.others_retention_days, DEFAULTS.others_retention_days, 0, 3650)
  out.lead_minutes = asInt(raw.lead_minutes, DEFAULTS.lead_minutes, 0, 240)
  out.reminders = asBool(raw.reminders, DEFAULTS.reminders)
  out.install_qq_module = asBool(raw.install_qq_module, DEFAULTS.install_qq_module)
  out.quiet_from = padClock(raw.quiet_from) || '00:30'
  out.quiet_to = padClock(raw.quiet_to) || '08:00'
  out.data_root = typeof raw.data_root === 'string' ? raw.data_root : ''
  return out
}

export function loadConfig(dataRoot) {
  ensureDir(dataRoot)
  const file = join(dataRoot, CONFIG_FILE)
  let parsed = null
  if (existsSync(file)) {
    try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
      try { atomicWrite(`${file}.bad-${Date.now()}`, readFileSync(file, 'utf8')) } catch {}
      parsed = null
    }
  }
  const cfg = normalizeConfig(parsed || {})
  if (!cfg.data_root) cfg.data_root = dataRoot
  saveConfig(dataRoot, cfg)
  return cfg
}

export function saveConfig(dataRoot, cfg) {
  ensureDir(dataRoot)
  const clean = normalizeConfig(cfg)
  clean.data_root = dataRoot
  atomicWrite(join(dataRoot, CONFIG_FILE), JSON.stringify(clean, null, 2) + '\n')
  return clean
}
