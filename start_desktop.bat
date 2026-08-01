@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"

cd /d "%PROJECT_ROOT%"

echo [1/3] Checking frontend dependencies...
if not exist "%PROJECT_ROOT%node_modules" (
  echo Installing frontend dependencies...
  call npm install --package-lock=false --no-audit --no-fund
  if errorlevel 1 if not exist "%PROJECT_ROOT%dist\index.html" goto :end
)

echo [1/3] Building frontend...
call npm run build
if errorlevel 1 goto :end

echo [2/3] Preparing backend runtime...
cd /d "%BACKEND_DIR%"
if exist "%cd%\tools\vgmstream\vgmstream-cli.exe" set "VGMSTREAM_CLI=%cd%\tools\vgmstream\vgmstream-cli.exe"
if not exist "%BACKEND_DIR%\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -3.11 -m venv "%BACKEND_DIR%\.venv"
  if errorlevel 1 goto :end
)
set "VENV_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"

echo Installing backend dependencies...
"%VENV_PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :end
"%VENV_PYTHON%" -m pip install -r "%BACKEND_DIR%\requirements.txt"
if errorlevel 1 goto :end
"%VENV_PYTHON%" "%BACKEND_DIR%\setup_tools.py"
if errorlevel 1 goto :end

echo [3/3] Launching desktop app...
"%VENV_PYTHON%" desktop_app.py

:end
pause
