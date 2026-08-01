$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$uv = Join-Path $appRoot "uv.exe"
$requirements = Join-Path $PSScriptRoot "requirements-ai.txt"
$dataRoot = Join-Path $env:LOCALAPPDATA "feedBack Studio"
$aiEnvironment = Join-Path $dataRoot "ai-env"

if (-not (Test-Path -LiteralPath $uv)) {
    throw "Optional AI installer is missing uv.exe."
}

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
& $uv venv --python 3.11 $aiEnvironment
if ($LASTEXITCODE -ne 0) {
    throw "Unable to prepare the private Python 3.11 AI environment."
}

$aiPython = Join-Path $aiEnvironment "Scripts\python.exe"
& $uv pip install --python $aiPython --requirement $requirements
if ($LASTEXITCODE -ne 0) {
    throw "Unable to install optional AI dependencies."
}

& $aiPython -c "import demucs, whisperx, lyrics_transcriber, torch, torchaudio; print('Optional AI components installed successfully')"
if ($LASTEXITCODE -ne 0) {
    throw "Optional AI dependency verification failed."
}
