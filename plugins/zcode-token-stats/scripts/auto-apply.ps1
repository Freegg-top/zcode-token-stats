# SessionStart auto-apply for the ZCode Token Stats overlay.
#
# Healthy (overlay already injected): silent, exits without doing anything.
# Overlay missing: arms a detached one-shot waiter that installs the overlay
# as soon as ZCode fully exits, verifies the result, and relaunches ZCode.
# Re-arming writes a fresh arm token, so a stale waiter sees a different token
# and exits — multiple sessions can never double-install.
# app.asar is locked while ZCode runs, so the patch can only happen after exit;
# this hook makes that invisible to the user except for the restart itself.
param(
  [switch]$Verify,      # exit 0 if the overlay is injected, 1 otherwise
  [switch]$NoRelaunch,  # arm the waiter but do not relaunch ZCode after install
  [switch]$PrintWaiter  # debug: print the waiter command instead of arming it
)
$ErrorActionPreference = 'SilentlyContinue'
$StampRoot = Join-Path $env:LOCALAPPDATA 'ZCodeTokenStats'
$LogPath   = Join-Path $StampRoot 'auto-apply.log'
$ArmPath   = Join-Path $StampRoot 'auto-apply.arm'

function Find-AppAsar {
  $candidates = New-Object System.Collections.Generic.List[string]
  # Process name is "ZCode"; a plain -Name ZCode wildcard does not match it.
  Get-Process -Name 'ZCode' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path) { $candidates.Add((Join-Path (Split-Path -Parent $_.Path) 'resources\app.asar')) }
  }
  $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\ZCode\resources\app.asar'))
  $candidates.Add((Join-Path $env:ProgramFiles 'ZCode\resources\app.asar'))
  if ($env:ZCODE_HOME) { $candidates.Add((Join-Path $env:ZCODE_HOME 'resources\app.asar')) }
  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }
  return $null
}

function Read-AsarBytes([string]$Path, [long]$Offset, [long]$Size) {
  $fs = [System.IO.File]::OpenRead($Path)
  try {
    $fs.Position = $Offset
    $buffer = New-Object byte[] $Size
    $read = 0
    while ($read -lt $Size) {
      $n = $fs.Read($buffer, $read, $Size - $read)
      if ($n -le 0) { break }
      $read += $n
    }
    return $buffer
  } finally { $fs.Close() }
}

function Test-OverlayInstalled([string]$Asar) {
  # Same detection as update-overlay.ps1: scan the styles-*.js renderer
  # bundles for the overlay marker without parsing the multi-MB asar header.
  $prefix = Read-AsarBytes $Asar 0 16
  if ([BitConverter]::ToUInt32($prefix, 0) -ne 4) { return $false }
  $base = 8 + [BitConverter]::ToUInt32($prefix, 4)
  $jsonLen = [BitConverter]::ToUInt32($prefix, 12)
  $json = [System.Text.Encoding]::UTF8.GetString((Read-AsarBytes $Asar 16 $jsonLen))
  foreach ($m in [regex]::Matches($json, '"(styles-[^"]+\.js)":\{"size":(\d+),"offset":"(\d+)"')) {
    $size = [long]$m.Groups[2].Value
    if ($size -le 0 -or $size -ge 64MB) { continue }
    $text = [System.Text.Encoding]::UTF8.GetString((Read-AsarBytes $Asar ($base + [long]$m.Groups[3].Value) $size))
    if ($text.Contains('token-speed-indicator')) { return $true }
  }
  return $false
}

if ($Verify) {
  $asar = Find-AppAsar
  if ($asar -and (Test-OverlayInstalled $asar)) { exit 0 }
  exit 1
}

$asar = Find-AppAsar
if (-not $asar) { if (-not $PrintWaiter) { exit 0 } } else { if ((Test-OverlayInstalled $asar) -and -not $PrintWaiter) { exit 0 } }

# --- Overlay missing: arm the one-shot waiter -------------------------------
New-Item -ItemType Directory -Path $StampRoot -Force | Out-Null
$token = [guid]::NewGuid().ToString('N')
Set-Content -LiteralPath $ArmPath -Value $token

$exe = $null
Get-Process -Name 'ZCode' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { $exe = $_.Path } }
if (-not $exe) { $exe = Join-Path $env:LOCALAPPDATA 'Programs\ZCode\ZCode.exe' }

$updater = Join-Path $PSScriptRoot 'update-overlay.ps1'
$self    = $PSCommandPath
$waiter  = @"
`$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Name 'ZCode' -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }
if ((Get-Content -LiteralPath '$ArmPath' -Raw).Trim() -ne '$token') { exit 0 }
Start-Sleep -Seconds 3
Add-Content -LiteralPath '$LogPath' -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] ZCode 已退出，开始安装 Token 统计胶囊 ...")
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$updater' -Install -NoPause *>> '$LogPath'
Add-Content -LiteralPath '$LogPath' -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] 安装器退出码 " + `$LASTEXITCODE)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '$self' -Verify
"@
if (-not $NoRelaunch) {
  $waiter += "`n" + @"
if (`$LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath '$exe')) {
  Start-Process -FilePath '$exe'
  Add-Content -LiteralPath '$LogPath' -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] 注入校验通过，已自动重启 ZCode。")
}
"@
} else {
  $tail = 'Add-Content -LiteralPath ''{0}'' -Value ("[" + (Get-Date -Format ''yyyy-MM-dd HH:mm:ss'') + "] 注入校验退出码 " + `$LASTEXITCODE)' -f $LogPath
  $waiter += "`n" + $tail
}

if ($PrintWaiter) { Write-Output $waiter; exit 0 }
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', $waiter) -WindowStyle Hidden

Write-Output 'ZCode Token 统计：检测到胶囊未注入，已挂自动安装任务——完全退出 ZCode 后将自动完成注入并重启。'
exit 0
