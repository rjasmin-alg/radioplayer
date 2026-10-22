@echo off
rem RadioPlayer - pokretanje na Windowsima (treba Node.js 18 ili noviji: https://nodejs.org)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nije instaliran. Preuzmi ga s https://nodejs.org i pokreni ponovno.
  pause
  exit /b 1
)
title RadioPlayer
node server.js --open
pause
