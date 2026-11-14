#Requires -Version 5.1
<#
.SYNOPSIS
    Pre-seed @wernerbisschoff/libref documentation packages
    (Windows port of run_once_after_seed-context-docs.sh).

.DESCRIPTION
    Registry packages use `libref install <registry/name>`; git-origin packages
    use `libref add <url>`. Every entry is best-effort - a single failure only
    warns, so a flaky network cannot wedge the apply.
#>
$ErrorActionPreference = 'Stop'

if (-not (Get-Command libref -ErrorAction SilentlyContinue)) {
    Write-Warning 'libref CLI not installed - install with: npm i -g @wernerbisschoff/libref'
    exit 0
}

function Add-LibrefPackage {
    param([Parameter(Mandatory)][string[]]$Arguments, [string]$Label)

    $null = & libref @Arguments 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "  [OK] $Label"
    }
    else {
        Write-Warning "  $Label failed"
    }
}

Write-Output '[INFO] Seeding Python docs...'
if (Get-Command pip -ErrorAction SilentlyContinue) {
    foreach ($package in @('fastapi', 'django', 'pydantic', 'flask')) {
        Add-LibrefPackage -Arguments @('install', "pip/$package") -Label $package
    }
}
else {
    Write-Output '[SKIP] pip not found - skipping Python packages'
}

Write-Output '[INFO] Seeding frontend docs...'
$frontend = [ordered]@{
    'react'      = 'React'
    'next'       = 'Next.js'
    'typescript' = 'TypeScript'
    'tailwind'   = 'Tailwind CSS'
}
foreach ($name in $frontend.Keys) {
    Add-LibrefPackage -Arguments @('install', "npm/$name") -Label $frontend[$name]
}

Write-Output '[INFO] Seeding Elixir ecosystem docs...'
Add-LibrefPackage -Arguments @('add', 'https://github.com/elixir-lang/elixir/tree/v1.20-latest', '--name', 'elixir') -Label 'Elixir'
Add-LibrefPackage -Arguments @('add', 'https://phoenix.hexdocs.pm/') -Label 'Phoenix'
Add-LibrefPackage -Arguments @('add', 'https://phoenix-live-view.hexdocs.pm/') -Label 'Phoenix LiveView'

Write-Output '[OK] Libref doc seeding complete'
exit 0
