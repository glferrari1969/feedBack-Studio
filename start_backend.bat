@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"

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

echo Starting backend server...
"%VENV_PYTHON%" -m uvicorn app.main:app --reload --port 8000

:end
pause
