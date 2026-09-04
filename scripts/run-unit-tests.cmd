@echo off
setlocal
cd /d "%~dp0\.."
node scripts\run-unit-tests-report.js
exit /b %ERRORLEVEL%
