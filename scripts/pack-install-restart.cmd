@echo off
setlocal
cd /d "%~dp0\.."
node scripts\pack-install-restart.js
exit /b %ERRORLEVEL%
