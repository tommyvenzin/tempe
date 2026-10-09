@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build.ps1" -CheckOnly
set "TempeExit=%ERRORLEVEL%"
pause
exit /b %TempeExit%
