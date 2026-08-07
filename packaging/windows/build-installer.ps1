param(
    [string]$Version = "0.1.0-alpha.4",
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
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE"
        }
        & $Python -m pip install --upgrade pip
        if ($LASTEXITCODE -ne 0) {
            throw "pip upgrade failed with exit code $LASTEXITCODE"
        }
        & $Python -m pip install -r "backend\requirements-core.txt" pyinstaller uv
        if ($LASTEXITCODE -ne 0) {
            throw "Core dependency installation failed with exit code $LASTEXITCODE"
        }
    }

    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }
    & $Python "backend\setup_tools.py"
    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg setup failed with exit code $LASTEXITCODE"
    }

    & $Python -m PyInstaller `
        --noconfirm `
        --clean `
        --distpath $windowsBuild `
        --workpath $pyinstallerWork `
        $specPath
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE"
    }

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

    $installerName = "feedBack-Studio-$Version-Windows-x64-Setup.exe"
    $temporaryInstallerRoot = Join-Path `
        ([System.IO.Path]::GetTempPath()) `
        ("feedbackstudio-installer-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $temporaryInstallerRoot | Out-Null
    try {
        & $Iscc "/DMyAppVersion=$Version" "/O$temporaryInstallerRoot" $issPath
        if ($LASTEXITCODE -ne 0) {
            throw "Inno Setup failed with exit code $LASTEXITCODE"
        }

        $compiledInstaller = Join-Path $temporaryInstallerRoot $installerName
        if (-not (Test-Path -LiteralPath $compiledInstaller)) {
            throw "Inno Setup did not create the expected installer: $compiledInstaller"
        }

        New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
        Copy-Item `
            -LiteralPath $compiledInstaller `
            -Destination (Join-Path $releaseRoot $installerName) `
            -Force
    } finally {
        $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        $resolvedTemporaryInstallerRoot = [System.IO.Path]::GetFullPath($temporaryInstallerRoot)
        if ($resolvedTemporaryInstallerRoot.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemporaryInstallerRoot).StartsWith("feedbackstudio-installer-")) {
            Remove-Item -LiteralPath $resolvedTemporaryInstallerRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Get-Item -LiteralPath (Join-Path $releaseRoot $installerName)
} catch {
    if ($env:GITHUB_ACTIONS -eq "true") {
        $annotationMessage = $_.Exception.Message.Replace("`r", " ").Replace("`n", " ")
        Write-Host "::error title=Windows installer build failed::$annotationMessage"
    }
    throw
} finally {
    Pop-Location
}
