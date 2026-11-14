#Requires -Version 5.1
<#
.SYNOPSIS
    Register pi and herdr as global mise tools (Windows port of
    run_once_after_install-ai-mise-tools.sh).

.DESCRIPTION
    `pi` is not pinned in [tools]; the global mise config is owned imperatively
    by `mise use -g`. This re-asserts the shims after an apply. Failures are
    warnings, not errors: a broken toolchain must not abort a config apply.
#>
$ErrorActionPreference = 'Stop'

if (-not (Get-Command mise -ErrorAction SilentlyContinue)) {
    Write-Output '[SKIP] mise not installed - skipping global AI tool registration'
    exit 0
}

# herdr has no Windows build; register and upgrade it only when it resolves.
$results = & mise use -g --remove pi 'npm:@earendil-works/pi-coding-agent@latest' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning "mise use -g failed: $results"
    exit 0
}

$results = & mise use -g 'herdr@latest' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output '[SKIP] herdr is not available on this platform'
}

$null = & mise install 2>&1
$results = & mise upgrade --bump npm:@earendil-works/pi-coding-agent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning "mise upgrade failed: $results"
}

Write-Output '[OK] AI mise tools registered globally'
exit 0
