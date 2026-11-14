#Requires -Version 5.1
<#
.SYNOPSIS
    Upgrade pi and herdr after an apply (Windows port of
    run_after_upgrade-ai-mise-tools.sh).

.DESCRIPTION
    Runs on every apply, like the shell twin, so `mise upgrade --bump` keeps the
    shims current. Always exits 0: an offline machine must not fail an apply.
#>
$ErrorActionPreference = 'Stop'

if (-not (Get-Command mise -ErrorAction SilentlyContinue)) {
    Write-Output '[SKIP] mise not installed'
    exit 0
}

$null = & mise upgrade --bump npm:@earendil-works/pi-coding-agent 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'mise upgrade --bump pi failed (offline?)'
}

$null = & mise upgrade --bump herdr 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output '[SKIP] herdr is not available on this platform'
}

exit 0
