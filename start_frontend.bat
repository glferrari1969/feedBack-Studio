@echo off
setlocal
set "PROJECT_ROOT=%~dp0"

cd /d "%PROJECT_ROOT%"

if not exist "%PROJECT_ROOT%node_modules" (
  echo Installing frontend dependencies...
  call npm install --package-lock=false --no-audit --no-fund
  if errorlevel 1 exit /b %errorlevel%
)

echo Starting frontend preview server...
echo Open the URL shown in the terminal, usually http://localhost:5173
call npm run dev
pause
