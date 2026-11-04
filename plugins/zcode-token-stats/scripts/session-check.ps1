# SessionStart drift check for the ZCode Token Stats overlay.
# Read-only and offline: reports only when the overlay is missing from the
# current ZCode install (e.g. ZCode was upgraded and overwrote app.asar).
# Silent when healthy. Never blocks or modifies anything.
$ErrorActionPreference = 'SilentlyContinue'

function Find-AppAsar {
  $candidates = New-Object System.Collections.Generic.List[string]
  Get-Process -Name ZCode -ErrorAction SilentlyContinue | ForEach-Object {
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

try {
  $asar = Find-AppAsar
  if (-not $asar) { exit 0 }

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

  $prefix = Read-AsarBytes $asar 0 16
  if ([BitConverter]::ToUInt32($prefix, 0) -ne 4) { exit 0 }
  # PS 5.1 ConvertFrom-Json rejects the multi-MB asar header; regex the
  # styles-*.js entries out of the header JSON instead.
  $base = 8 + [BitConverter]::ToUInt32($prefix, 4)
  $jsonLen = [BitConverter]::ToUInt32($prefix, 12)
  $json = [System.Text.Encoding]::UTF8.GetString((Read-AsarBytes $asar 16 $jsonLen))

  $sawAnyBundle = $false
  foreach ($m in [regex]::Matches($json, '"(styles-[^"]+\.js)":\{"size":(\d+),"offset":"(\d+)"')) {
    $size = [long]$m.Groups[2].Value
    if ($size -le 0 -or $size -ge 64MB) { continue }
    $text = [System.Text.Encoding]::UTF8.GetString((Read-AsarBytes $asar ($base + [long]$m.Groups[3].Value) $size))
    if ($text.Length -gt 0) { $sawAnyBundle = $true }
    if ($text.Contains('token-speed-indicator')) { exit 0 }
  }
  if (-not $sawAnyBundle) { exit 0 }
  Write-Output 'ZCode Token 统计：当前 ZCode 未检测到注入（可能刚升级覆盖了 app.asar）。需要恢复时运行 /install-overlay。'
} catch { }
exit 0
