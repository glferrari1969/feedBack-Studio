@echo off
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
"%VENV_PYTHON%" -m uvicorn app.main:app --reload --port 8000

:end
pause
