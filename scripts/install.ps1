# 一键接入 DSH profile（Windows）
# 用法：powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Profile desktop]
param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

# DSH 用 JSON.parse 读 package.json；文件开头的 BOM 会让它直接报错、插件被拒绝加载。
# 从 zip / 旧版本装进来时先自愈一次。
$pluginPkg = Join-Path $src 'package.json'
if (Test-Path $pluginPkg) {
  $bytes = [System.IO.File]::ReadAllBytes($pluginPkg)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
    [System.IO.File]::WriteAllText($pluginPkg, $text, $utf8)
    Write-Host "已去掉插件 package.json 的 BOM" -ForegroundColor Yellow
  }
}

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

[System.IO.File]::WriteAllText($pkgFile, (($json | ConvertTo-Json -Depth 20) + "`n"), $utf8)
$written = [System.IO.File]::ReadAllBytes($pkgFile)
if ($written.Length -ge 3 -and $written[0] -eq 0xEF -and $written[1] -eq 0xBB -and $written[2] -eq 0xBF) {
  throw "写出来的 package.json 还是带 BOM：$pkgFile"
}

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
