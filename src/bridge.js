// 把 QQ 侧那个小模块装进 aurabot：只在 aurabot 已安装时做，装完写 bridge.json。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export function aurabotRoot() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), '.dsh')
  return join(home, 'plugins-data', 'aurabot')
}

export function bridgeFile() {
  return join(aurabotRoot(), 'modules-data', 'ear', 'bridge.json')
}

/**
 * @param {{source: string, bridge: object, log: Function}} o
 * @returns {{ok:boolean, installed?:boolean, changed?:boolean, reason?:string}}
 */
export function installQqModule({ source, bridge, log }) {
  const root = aurabotRoot()
  if (!existsSync(root)) return { ok: false, reason: '没找到 aurabot（plugins-data/aurabot），跳过 QQ 侧模块' }
  const modDir = join(root, 'modules', 'ear')
  const dataDir = join(root, 'modules-data', 'ear')
  try {
    mkdirSync(modDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
  } catch (error) {
    return { ok: false, reason: '建目录失败：' + String(error && error.message) }
  }
  const target = join(modDir, 'index.mjs')
  let changed = true
  try { if (readFileSync(target, 'utf8') === source) changed = false } catch (error) {}
  if (changed) {
    try { writeFileSync(target, source, 'utf8') } catch (error) { return { ok: false, reason: '写模块失败：' + String(error && error.message) } }
  }
  try {
    writeFileSync(join(dataDir, 'bridge.json'), JSON.stringify({ ...bridge, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch (error) {
    return { ok: false, reason: '写 bridge.json 失败：' + String(error && error.message) }
  }
  if (changed) log?.('bridge', { result: 'module_written', dir: modDir })
  return { ok: true, installed: true, changed }
}
