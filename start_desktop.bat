@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Building frontend...
if not exist "%~dp0node_modules" (
  call npm install --no-audit --no-fund
  if errorlevel 1 if not exist "%~dp0dist\index.html" goto :end
)
if not exist "%~dp0dist\index.html" (
  call npm run build
  if errorlevel 1 goto :end
)

echo [2/3] Preparing backend runtime...
cd /d "%~dp0backend"
if exist "%cd%\tools\vgmstream\vgmstream-cli.exe" set "VGMSTREAM_CLI=%cd%\tools\vgmstream\vgmstream-cli.exe"
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
  if errorlevel 1 goto :end
)
set "VENV_PYTHON=.venv\Scripts\python.exe"
"%VENV_PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :end
"%VENV_PYTHON%" -m pip install -r requirements.txt
if errorlevel 1 goto :end
"%VENV_PYTHON%" setup_tools.py
if errorlevel 1 goto :end

echo [3/3] Launching desktop app...
"%VENV_PYTHON%" desktop_app.py

:end
pause
