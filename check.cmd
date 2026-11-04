@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Action check
set "code=%ERRORLEVEL%"
exit /b %code%
