@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch.ps1" -Mode Online
set "TempeExit=%ERRORLEVEL%"
if not "%TempeExit%"=="0" pause
exit /b %TempeExit%
