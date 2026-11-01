# 从 DSH profile 里移除 dsh-ear（Windows）
param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgFile = Join-Path $profileDir 'package.json'

if (-not (Test-Path $pkgFile)) { Write-Host "找不到 $pkgFile" -ForegroundColor Red; exit 1 }

Copy-Item $pkgFile "$pkgFile.bak-ear-$(Get-Date -Format yyyyMMddHHmmss)"
$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($json.dependencies -and $json.dependencies.'dsh-ear') { $json.dependencies.PSObject.Properties.Remove('dsh-ear') }
if ($json.dsh.profile.bundles) {
  $json.dsh.profile.bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-ear' })
}
[System.IO.File]::WriteAllText($pkgFile, (($json | ConvertTo-Json -Depth 20) + "`n"), $utf8)

$link = Join-Path $profileDir 'node_modules\dsh-ear'
if (Test-Path $link) { Remove-Item $link -Force -Recurse }

Write-Host "已移除。重启 DSH 生效。数据目录没有被删。" -ForegroundColor Green
