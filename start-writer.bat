@echo off
rem Ayodhyya Writer launcher - double-click (or taskbar shortcut) to start the app.
rem Serves the offline-first writer UI, then opens it in your default browser.
title Ayodhyya Writer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js v18+ is required to run Ayodhyya Writer.
  echo Install it from https://nodejs.org/ , then double-click this again.
  pause
  exit /b 1
)
start "Ayodhyya Writer server" /min node tools\preview.mjs --admin
timeout /t 3 /nobreak >nul
start "" "http://localhost:8080/index.html"
echo.
echo Ayodhyya Writer is running at http://localhost:8080/index.html
echo The server keeps running in a minimized window - use stop-writer.bat to shut it down.
