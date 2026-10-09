@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Desk.ps1"
set "TempeExit=%ERRORLEVEL%"
pause
exit /b %TempeExit%
