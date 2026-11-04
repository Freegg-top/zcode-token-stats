param(
  [ValidateSet('menu', 'apply', 'remove', 'check')]
  [string]$Action = 'menu',
  [string]$ZCodePath = '',
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-ZCodeExe([string]$Path) {
  return $Path -and (Test-Path -LiteralPath $Path -PathType Leaf) -and ((Split-Path -Leaf $Path) -ieq 'ZCode.exe')
}

function Find-ZCode {
  $candidates = New-Object System.Collections.Generic.List[string]

  if ($ZCodePath) {
    if (Test-Path -LiteralPath $ZCodePath -PathType Leaf) {
      if ((Split-Path -Leaf $ZCodePath) -ieq 'app.asar') {
        $candidates.Add((Join-Path (Split-Path -Parent (Split-Path -Parent $ZCodePath)) 'ZCode.exe'))
      } else {
        $candidates.Add($ZCodePath)
      }
    } elseif (Test-Path -LiteralPath $ZCodePath -PathType Container) {
      $candidates.Add((Join-Path $ZCodePath 'ZCode.exe'))
    }
  }

  Get-Process -Name ZCode -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path) { $candidates.Add($_.Path) }
  }

  $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\ZCode\ZCode.exe'))
  $candidates.Add((Join-Path $env:ProgramFiles 'ZCode\ZCode.exe'))
  if (${env:ProgramFiles(x86)}) {
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'ZCode\ZCode.exe'))
  }
  if ($env:ZCODE_HOME) { $candidates.Add((Join-Path $env:ZCODE_HOME 'ZCode.exe')) }

  $uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $uninstallRoots) {
    try {
      Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*ZCode*' } |
        ForEach-Object {
          if ($_.InstallLocation) {
            $candidates.Add((Join-Path $_.InstallLocation 'ZCode.exe'))
          }
          if ($_.DisplayIcon) {
            $icon = ($_.DisplayIcon -replace ',\d+\s*$', '').Trim('"')
            if ($icon) { $candidates.Add($icon) }
          }
        }
    } catch {}
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-ZCodeExe $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return $null
}

function Resolve-ZCode {
  $exe = Find-ZCode
  if (-not $exe) {
    Write-Host '未自动找到 ZCode。' -ForegroundColor Yellow
    $entered = Read-Host '请输入 ZCode.exe 的完整路径（直接回车取消）'
    if ($entered) {
      $script:ZCodePath = $entered.Trim('"')
      $exe = Find-ZCode
    }
  }
  if (-not $exe) {
    throw '未找到 ZCode。请先安装 ZCode，或用 -ZCodePath 指定 ZCode.exe。'
  }
  return $exe
}

function Stop-ZCodeForPatch {
  $running = @(Get-Process -Name ZCode -ErrorAction SilentlyContinue)
  if ($running.Count -eq 0) { return }

  Write-Host ''
  Write-Host 'ZCode 正在运行，安装/卸载前必须完全退出。' -ForegroundColor Yellow
  $answer = Read-Host '是否现在自动关闭 ZCode？请先保存工作 [Y/N]'
  if ($answer -notmatch '^[Yy]') {
    Write-Host '请手动完全退出 ZCode（包括托盘）后重新运行本安装器。' -ForegroundColor Yellow
    throw 'ZCode is still running.'
  }

  $running | ForEach-Object {
    try { [void]$_.CloseMainWindow() } catch {}
  }
  Start-Sleep -Seconds 3
  $remaining = @(Get-Process -Name ZCode -ErrorAction SilentlyContinue)
  if ($remaining.Count -gt 0) {
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  if (@(Get-Process -Name ZCode -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'ZCode 仍在运行，请从托盘退出后重试。'
  }
}

function Invoke-Patch([string]$Exe, [string]$Operation, [string]$Asar) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:ELECTRON_NO_ASAR = '1'
  try {
    $script = Join-Path $scriptRoot 'patch.js'
    $process = Start-Process -FilePath $Exe -ArgumentList @(
      ('"' + $script + '"'),
      $Operation,
      ('"' + $Asar + '"')
    ) -WorkingDirectory $scriptRoot -NoNewWindow -Wait -PassThru
    return $process.ExitCode
  } finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue
  }
}

function Invoke-PatchCaptured([string]$Exe, [string]$Operation, [string]$Asar) {
  $stdout = Join-Path $env:TEMP ('zts-' + [guid]::NewGuid().ToString('N') + '.out')
  $stderr = Join-Path $env:TEMP ('zts-' + [guid]::NewGuid().ToString('N') + '.err')
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:ELECTRON_NO_ASAR = '1'
  try {
    $script = Join-Path $scriptRoot 'patch.js'
    $process = Start-Process -FilePath $Exe -ArgumentList @(
      ('"' + $script + '"'),
      $Operation,
      ('"' + $Asar + '"')
    ) -WorkingDirectory $scriptRoot -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $text = ''
    if (Test-Path -LiteralPath $stdout) { $text += (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) }
    if (Test-Path -LiteralPath $stderr) { $text += (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue) }
    return [pscustomobject]@{ Code = $process.ExitCode; Text = $text.Trim() }
  } finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
  }
}

function Wait-AnyKey {
  if ($NoPause) { return }
  Write-Host ''
  Write-Host '按任意键退出...' -ForegroundColor Yellow
  try {
    [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  } catch {
    [void](Read-Host)
  }
  Write-Host ''
}

function Write-Section([string]$Title) {
  Write-Host ''
  Write-Host ('  ' + $Title) -ForegroundColor Cyan
  Write-Host '  ------------------------------------' -ForegroundColor DarkGray
}

function Invoke-Check([string]$Exe, [string]$Asar) {
  Write-Host '  正在检查当前状态...' -ForegroundColor DarkGray
  $result = Invoke-PatchCaptured $Exe 'check' $Asar
  if ($result.Code -ne 0) {
    if ($result.Text) { Write-Host $result.Text -ForegroundColor DarkGray }
    throw "检查失败，退出码 $($result.Code)。"
  }
  $status = $null
  try { $status = $result.Text | ConvertFrom-Json } catch {}
  if (-not $status) {
    Write-Host $result.Text
    return
  }
  Write-Section '当前状态'
  $patched = if ($status.patched) { '已安装' } else { '未安装' }
  $backend = if ($status.cliPatched) { '已启用' } else { '未启用' }
  Write-Host ('  渲染补丁    ' + $patched) -ForegroundColor $(if ($status.patched) { 'Green' } else { 'Yellow' })
  Write-Host ('  后台统计    ' + $backend) -ForegroundColor $(if ($status.cliPatched) { 'Green' } else { 'Yellow' })
  Write-Host ('  自动适配    ' + $(if ($status.autoAdaptable) { '支持' } else { '不支持' }))
  if ($status.component) { Write-Host ('  组件标识    ' + $status.component) -ForegroundColor DarkGray }
  Write-Host ''
  Write-Host '  检查完成。' -ForegroundColor Green
}

function Invoke-ApplyRemove([string]$Exe, [string]$Asar, [string]$Operation) {
  Stop-ZCodeForPatch
  Write-Section $(if ($Operation -eq 'apply') { '安装 / 更新' } else { '卸载' })
  if ($Operation -eq 'apply') {
    Write-Host '  正在应用 Token 统计补丁...' -ForegroundColor DarkGray
  } else {
    Write-Host '  正在恢复 ZCode 原始文件...' -ForegroundColor DarkGray
  }
  $result = Invoke-PatchCaptured $Exe $Operation $Asar
  if ($result.Code -ne 0) {
    if ($result.Text) { Write-Host $result.Text -ForegroundColor DarkGray }
    throw "操作失败，退出码 $($result.Code)。已尝试按备份恢复原包。"
  }
  Write-Host ''
  if ($Operation -eq 'apply') {
    Write-Host '  ✓ 安装完成' -ForegroundColor Green
    Write-Host '    请完全退出并重新打开 ZCode。' -ForegroundColor Gray
  } else {
    Write-Host '  ✓ 卸载完成' -ForegroundColor Green
    Write-Host '    已恢复原始文件，请重新打开 ZCode。' -ForegroundColor Gray
  }
  Write-Host '    安装器不会自动启动或关闭 ZCode。' -ForegroundColor DarkGray
}

function Show-Banner {
  Clear-Host
  Write-Host ''
  Write-Host '  ZCode Token Stats 1.0.0' -ForegroundColor Cyan
  Write-Host '  ------------------------------------' -ForegroundColor DarkGray
  Write-Host '  Token / 速度 / 子代理用量' -ForegroundColor Gray
  Write-Host ''
}

function Show-Menu {
  Write-Host '  请选择操作' -ForegroundColor White
  Write-Host ''
  Write-Host '  [1]  安装 / 更新' -ForegroundColor Green
  Write-Host '       应用补丁并保留安全备份' -ForegroundColor DarkGray
  Write-Host '  [2]  卸载' -ForegroundColor Yellow
  Write-Host '       恢复 ZCode 原始文件' -ForegroundColor DarkGray
  Write-Host '  [3]  检查状态' -ForegroundColor Cyan
  Write-Host '       查看补丁和适配状态' -ForegroundColor DarkGray
  Write-Host '  [4]  退出' -ForegroundColor Gray
  Write-Host ''
  $choice = Read-Host '  输入选项 (1-4)'
  switch ($choice.Trim()) {
    '1' { return 'apply' }
    '2' { return 'remove' }
    '3' { return 'check' }
    '4' { return 'exit' }
    default {
      Write-Host '  无效选项，请重新输入。' -ForegroundColor Yellow
      Start-Sleep -Milliseconds 700
      return Show-Menu
    }
  }
}

try {
  Show-Banner

  $operation = $Action
  if ($operation -eq 'menu') {
    $operation = Show-Menu
    if ($operation -eq 'exit') { exit 0 }
  }

  $exe = Resolve-ZCode
  $asar = Join-Path (Split-Path -Parent $exe) 'resources\app.asar'
  if (-not (Test-Path -LiteralPath $asar -PathType Leaf)) {
    throw "未找到 app.asar：$asar"
  }
  Write-Host ('  ZCode  ' + $exe) -ForegroundColor DarkGray
  Write-Host ''

  if ($operation -eq 'check') {
    Invoke-Check $exe $asar
  } else {
    Invoke-ApplyRemove $exe $asar $operation
  }
  Wait-AnyKey
  exit 0
} catch {
  Write-Host ''
  Write-Host ('  错误：' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '  补丁操作失败时，patch.js 会按备份恢复原包。' -ForegroundColor DarkGray
  Wait-AnyKey
  exit 1
}
