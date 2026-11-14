#Requires -Version 5.1
<#
.SYNOPSIS
    Install npm global packages (Windows port of run_once_after_npm-globals.sh).

.DESCRIPTION
    Content-tracked via run_once_after_: re-runs when this file changes.
    Every entry installs with `npm i -g <package>`.
#>
$ErrorActionPreference = 'Stop'

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Warning 'npm not available - skipping npm global installs'
    exit 0
}

function Install-NpmGlobal {
    param([Parameter(Mandatory)][string]$Package)

    $null = & npm ls -g --depth=0 $Package 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "  -> $Package already installed"
        return
    }

    Write-Output "[INFO] Installing $Package..."
    $results = & npm install -g $Package 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "[OK] $Package installed"
    }
    else {
        Write-Warning "$Package failed: $results"
    }
}

Install-NpmGlobal -Package '@zvec/zvec-grep'
Install-NpmGlobal -Package '@wernerbisschoff/libref'

exit 0
