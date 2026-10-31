# 一键接入 DSH profile（Windows）
# 用法：powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Profile desktop]
param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgFile = Join-Path $profileDir 'package.json'

if (-not (Test-Path $pkgFile)) {
  Write-Host "找不到 profile 的 package.json：$pkgFile" -ForegroundColor Red
  Write-Host "如果你的 profile 不叫 $Profile，用 -Profile 指定名字。"
  exit 1
}

$backup = "$pkgFile.bak-ear-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item $pkgFile $backup
Write-Host "已备份：$backup"

$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force }
$json.dependencies | Add-Member -NotePropertyName 'dsh-ear' -NotePropertyValue "link:$($src -replace '\\','/')" -Force

if (-not $json.dsh) { $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
if (-not $json.dsh.profile) { $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-ear') { $bundles += 'dsh-ear' }
$json.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force

($json | ConvertTo-Json -Depth 20) + "`n" | Set-Content $pkgFile -Encoding UTF8 -NoNewline

$nm = Join-Path $profileDir 'node_modules'
New-Item -ItemType Directory -Path $nm -Force | Out-Null
$link = Join-Path $nm 'dsh-ear'
if (-not (Test-Path $link)) { New-Item -ItemType Junction -Path $link -Target $src | Out-Null }

Write-Host ""
Write-Host "装好了。" -ForegroundColor Green
Write-Host "1) 重启 DSH"
Write-Host "2) 命令行敲 /ear 看地址和 token"
Write-Host "3) 防火墙放行 8788（管理员 PowerShell，只专用网络）："
Write-Host '   netsh advfirewall firewall add rule name="LuYinDou Ear 8788" dir=in action=allow protocol=TCP localport=8788 profile=private'
