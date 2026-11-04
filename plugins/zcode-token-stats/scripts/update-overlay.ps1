# ZCode Token Stats update helper.
# Check / install / uninstall the direct SQLite overlay via GitHub releases.
# Never creates resident processes; -WaitForExit spawns a one-shot waiter that
# exits right after the install finishes.
param(
  [switch]$Check,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$WaitForExit,
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$Repo = 'Freegg-top/zcode-token-stats'
$StampRoot = Join-Path $env:LOCALAPPDATA 'ZCodeTokenStats'

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

function Read-AsarBytes([string]$Asar, [long]$Offset, [long]$Size) {
  $fs = [System.IO.File]::OpenRead($Asar)
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

function Get-RendererBundleTexts([string]$Asar) {
  # PS 5.1 ConvertFrom-Json rejects the multi-MB asar header, so pull the
  # styles-*.js entries straight out of the header JSON with a regex instead.
  $texts = New-Object System.Collections.Generic.List[string]
  $prefix = Read-AsarBytes $Asar 0 16
  if ([BitConverter]::ToUInt32($prefix, 0) -ne 4) { throw "Not a supported ASAR archive: $Asar" }
  $base = 8 + [BitConverter]::ToUInt32($prefix, 4)
  $jsonLen = [BitConverter]::ToUInt32($prefix, 12)
  $json = [System.Text.Encoding]::UTF8.GetString((Read-AsarBytes $Asar 16 $jsonLen))
  foreach ($m in [regex]::Matches($json, '"(styles-[^"]+\.js)":\{"size":(\d+),"offset":"(\d+)"')) {
    $offset = $base + [long]$m.Groups[3].Value
    $size = [long]$m.Groups[2].Value
    if ($size -gt 0 -and $size -lt 64MB) {
      $texts.Add([System.Text.Encoding]::UTF8.GetString((Read-AsarBytes $Asar $offset $size)))
    }
  }
  return $texts
}

function Get-OverlayState([string]$Asar) {
  foreach ($text in (Get-RendererBundleTexts $Asar)) {
    if ($text.Contains('token-speed-indicator')) {
      $version = $null
      if ($text -match '__ztsVersion=`(\d+\.\d+\.\d+)`') { $version = $Matches[1] }
      return @{ Installed = $true; Version = $version }
    }
  }
  return @{ Installed = $false; Version = $null }
}

function Get-LatestRelease {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'zcode-token-stats-updater' }
}

function Test-ZCodeRunning { return @(Get-Process -Name ZCode -ErrorAction SilentlyContinue).Count -gt 0 }

function Wait-KeyIfAllowed { if (-not $NoPause) { try { Write-Host ''; Write-Host '按回车退出...' -ForegroundColor Yellow; [void](Read-Host) } catch {} } }

try {
  if ($Check) {
    $asar = Find-AppAsar
    if (-not $asar) { Write-Host '未找到 ZCode 安装（app.asar）。'; exit 1 }
    $state = Get-OverlayState $asar
    $latest = Get-LatestRelease
    $latestVersion = ($latest.tag_name -replace '^v', '')
    $installed = if ($state.Installed) { if ($state.Version) { $state.Version } else { '未知版本' } } else { '未安装' }
    Write-Host ("ZCode        " + $asar)
    Write-Host ("已安装版本   " + $installed)
    Write-Host ("最新版本     " + $latestVersion)
    if (-not $state.Installed) {
      Write-Host '状态         未安装（或 ZCode 升级后补丁被覆盖）' -ForegroundColor Yellow
    } elseif ($state.Version -and ([version]$latestVersion -gt [version]$state.Version)) {
      Write-Host '状态         有更新' -ForegroundColor Yellow
    } elseif (-not $state.Version) {
      Write-Host '状态         已安装（旧版无版本标记，可用 -Install 升级）' -ForegroundColor Yellow
    } else {
      Write-Host '状态         已是最新' -ForegroundColor Green
    }
    exit 0
  }

  if ($Install) {
    $latest = Get-LatestRelease
    $latestVersion = ($latest.tag_name -replace '^v', '')
    $zipAsset = $latest.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
    $shaAsset = $latest.assets | Where-Object { $_.name -like '*.sha256.txt' } | Select-Object -First 1
    if (-not $zipAsset -or -not $shaAsset) { throw 'Release 资产不完整（缺少 zip 或 sha256）。' }
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('zts-update-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    Write-Host ("下载 " + $zipAsset.name + " ...")
    $zipPath = Join-Path $work $zipAsset.name
    $shaPath = Join-Path $work $shaAsset.name
    Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath -UseBasicParsing
    Invoke-WebRequest -Uri $shaAsset.browser_download_url -OutFile $shaPath -UseBasicParsing
    $expected = ((Get-Content -LiteralPath $shaPath -Raw).Trim() -split '\s+')[0]
    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    if ($actual -ine $expected) { throw ("sha256 校验失败：期望 " + $expected + "，实际 " + $actual) }
    Write-Host 'sha256 校验通过。'
    Write-Host '解压 ...'
    $extractRoot = Join-Path $work 'extract'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $packageDir = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    $installer = Join-Path $packageDir.FullName '_internal\install.ps1'
    if (-not (Test-Path -LiteralPath $installer)) { throw '发布包缺少 _internal\install.ps1。' }

    if (Test-ZCodeRunning) {
      if ($WaitForExit) {
        $log = Join-Path $StampRoot 'update-overlay.log'
        New-Item -ItemType Directory -Path $StampRoot -Force | Out-Null
        $waiter = "while (Get-Process -Name ZCode -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }`n" +
                  "try { powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -Action apply -NoPause *> `"$log`" } catch { \$_ | Out-File `"$log`" }"
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', $waiter) -WindowStyle Hidden
        Write-Host 'ZCode 正在运行：已挂一次性等待任务，ZCode 完全退出后自动安装（仅运行一次，安装完即退出）。'
        Write-Host ("日志： " + $log)
        Write-Host '安装完成后请重新打开 ZCode。'
      } else {
        Write-Host 'ZCode 正在运行，未修改任何文件。' -ForegroundColor Yellow
        Write-Host '请完全退出 ZCode（包括托盘）后重新运行 -Install；或加 -WaitForExit 等待退出后自动安装。'
      }
      exit 0
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action apply -NoPause
    if ($LASTEXITCODE -ne 0) { throw ("安装器退出码 " + $LASTEXITCODE) }
    Write-Host ''
    Write-Host '安装完成。请重新打开 ZCode。' -ForegroundColor Green
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }

  if ($Uninstall) {
    if (Test-ZCodeRunning) {
      Write-Host 'ZCode 正在运行，请先完全退出（包括托盘）后再卸载。' -ForegroundColor Yellow
      exit 1
    }
    $asar = Find-AppAsar
    if (-not $asar) { throw '未找到 ZCode 安装（app.asar）。' }
    $state = Get-OverlayState $asar
    if (-not $state.Installed) { Write-Host '未检测到 Token 统计注入，无需卸载。'; exit 0 }
    $latest = Get-LatestRelease
    $zipAsset = $latest.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
    if (-not $zipAsset) { throw 'Release 资产不完整。' }
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('zts-update-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    Write-Host ("下载 " + $zipAsset.name + " ...")
    $zipPath = Join-Path $work $zipAsset.name
    Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath -UseBasicParsing
    $extractRoot = Join-Path $work 'extract'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    $packageDir = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    $installer = Join-Path $packageDir.FullName '_internal\install.ps1'
    if (-not (Test-Path -LiteralPath $installer)) { throw '发布包缺少 _internal\install.ps1。' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Action remove -NoPause
    if ($LASTEXITCODE -ne 0) { throw ("卸载器退出码 " + $LASTEXITCODE) }
    Write-Host ''
    Write-Host '卸载完成。请重新打开 ZCode。' -ForegroundColor Green
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }

  Write-Host '用法： update-overlay.ps1 -Check | -Install [-WaitForExit] | -Uninstall'
  exit 1
} catch {
  Write-Host ('错误： ' + $_.Exception.Message) -ForegroundColor Red
  Wait-KeyIfAllowed
  exit 1
}
