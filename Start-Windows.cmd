@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org and retry.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies. This can take a minute...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://127.0.0.1:8788/'"
echo Sumo Classic Craft - World of CarrickCraft is starting at http://127.0.0.1:8788/ (press Ctrl+C to stop)
call npm start
if errorlevel 1 (
  echo Startup failed. Read the messages above, then retry.
  pause
  exit /b 1
)
pause
