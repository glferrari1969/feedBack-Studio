param(
    [string]$Version = "0.1.0-alpha.1",
    [string]$Python = "python",
    [string]$Iscc = "",
    [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$buildRoot = Join-Path $repoRoot "build"
$windowsBuild = Join-Path $buildRoot "windows"
$pyinstallerWork = Join-Path $buildRoot "pyinstaller"
$releaseRoot = Join-Path $repoRoot "release"
$specPath = Join-Path $PSScriptRoot "feedBackStudio.spec"
$issPath = Join-Path $PSScriptRoot "installer.iss"

Push-Location $repoRoot
try {
    if (-not $SkipDependencies) {
        npm ci
        & $Python -m pip install --upgrade pip
        & $Python -m pip install -r "backend\requirements-core.txt" pyinstaller uv
    }

    npm run build
    & $Python "backend\setup_tools.py"

    & $Python -m PyInstaller `
        --noconfirm `
        --clean `
        --distpath $windowsBuild `
        --workpath $pyinstallerWork `
        $specPath

    $uvPath = (& $Python -c "import shutil; print(shutil.which('uv') or '')").Trim()
    if (-not $uvPath -or -not (Test-Path -LiteralPath $uvPath)) {
        throw "uv.exe was not found after dependency installation."
    }
    Copy-Item -LiteralPath $uvPath -Destination (Join-Path $windowsBuild "feedBackStudio\uv.exe") -Force

    $packagedExe = Join-Path $windowsBuild "feedBackStudio\feedBackStudio.exe"
    if (-not (Test-Path -LiteralPath $packagedExe)) {
        throw "Packaged executable was not created: $packagedExe"
    }
    & $packagedExe --smoke-test
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged executable smoke test failed with exit code $LASTEXITCODE"
    }

    if (-not $Iscc) {
        $isccCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($isccCommand) {
            $Iscc = $isccCommand.Source
        } else {
            $defaultIscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
            if (Test-Path -LiteralPath $defaultIscc) {
                $Iscc = $defaultIscc
            }
        }
    }
    if (-not $Iscc -or -not (Test-Path -LiteralPath $Iscc)) {
        throw "Inno Setup 6 compiler (ISCC.exe) was not found."
    }

    New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
    & $Iscc "/DMyAppVersion=$Version" $issPath
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup failed with exit code $LASTEXITCODE"
    }

    Get-ChildItem -LiteralPath $releaseRoot -Filter "feedBack-Studio-$Version-Windows-x64-Setup.exe"
} finally {
    Pop-Location
}
