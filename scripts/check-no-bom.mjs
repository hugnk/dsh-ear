// 检查仓库里的文本文件有没有 UTF-8 BOM。
// DSH 用 JSON.parse 读 package.json，BOM 会让插件在启动时被拒绝加载；
// 这个检查放在 CI 里，防止再提交带 BOM 的 package.json / patch。
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['.git', 'node_modules', '.aurabot-cache'])
const EXT = new Set(['.json', '.yml', '.yaml', '.js', '.mjs', '.ps1'])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(name.name)) continue
    const full = join(dir, name.name)
    if (name.isDirectory()) out.push(...walk(full))
    else if (EXT.has(name.name.slice(name.name.lastIndexOf('.')))) out.push(full)
  }
  return out
}

let bad = 0
for (const file of walk(ROOT)) {
  const b = readFileSync(file)
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    console.error(`BOM: ${relative(ROOT, file)}`)
    bad++
  }
}

try {
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
} catch (error) {
  console.error('package.json is not valid JSON:', error.message)
  bad++
}

if (bad) process.exit(1)
console.log('no BOM; package.json is valid JSON')
