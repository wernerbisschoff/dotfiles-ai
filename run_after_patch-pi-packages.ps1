#Requires -Version 5.1
<#
.SYNOPSIS
    Re-apply the local pi package patches (Windows port of
    run_after_patch-acp-summary-budget.sh + run_after_patch-pi-lens-tool-schema.sh).

.DESCRIPTION
    Two upstream defects are worked around by rewriting a single line in the
    installed dist bundle. Both patches are literal, idempotent replacements and
    both are skipped silently when the package is absent, so this survives
    package updates and machines that do not install the package at all.

    1. billion-context-pi-lean budgets every summary at
       ceil(summaryMaxChars / 3) tokens (6667 by default) and calls complete()
       with no reasoning level. Reasoning models spend that budget thinking, so
       large ranges fail with "compression model hit its output limit" and idle
       auto-compaction degrades to the caller fallback every time. The patch
       raises the ceiling (still 3x the char budget, capped at 32768); returned
       summaries stay bounded by the existing maxSummaryLength validator.

    2. pi-lens declares `commandArguments: Type.Array(Type.Unknown())`, which
       serialises to {"type":"array","items":{}}. OpenAI-compatible upstreams
       reject the whole tool list with invalid_function_parameters ("schema must
       have a 'type' key"), which fails any request carrying the full tool list
       - including ACP summaries. Unsafe is the only typebox constructor that
       keeps "any JSON value" while emitting a `type` key.

    Pi loads both files at startup - restart pi to pick the patches up.
#>
$ErrorActionPreference = 'Stop'

$HomeDir = [Environment]::GetFolderPath('UserProfile')

function Update-SourceLine {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Original,
        [Parameter(Mandatory)][string]$Patched,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Output "[SKIP] $Label not installed"
        return
    }

    $text = [System.IO.File]::ReadAllText($Path)

    if ($text.Contains($Patched)) {
        Write-Output "[OK] $Label already patched"
        return
    }

    if (-not $text.Contains($Original)) {
        Write-Warning "${Label}: target line not found - patch skipped (upstream changed it?)"
        return
    }

    try {
        [System.IO.File]::WriteAllText(
            $Path,
            $text.Replace($Original, $Patched),
            (New-Object System.Text.UTF8Encoding($false))
        )
        Write-Output "[OK] Patched $Label (restart pi to load it)"
    }
    catch {
        Write-Warning "${Label}: could not write $Path - $($_.Exception.Message)"
    }
}

$nodeModules = Join-Path $HomeDir '.pi\agent\npm\node_modules'

Update-SourceLine `
    -Path (Join-Path $nodeModules 'billion-context-pi-lean\dist\index.js') `
    -Original '  const maxTokens = Math.max(256, Math.ceil((input.summaryMaxChars ?? 2e4) / 3));' `
    -Patched '  const maxTokens = Math.min(32768, Math.max(8192, Math.ceil((input.summaryMaxChars ?? 2e4) / 3) * 3));' `
    -Label 'ACP summary budget (billion-context-pi-lean)'

Update-SourceLine `
    -Path (Join-Path $nodeModules 'pi-lens\dist\index.js') `
    -Original 'commandArguments: Type.Optional(Type.Array(Type.Unknown(), {' `
    -Patched 'commandArguments: Type.Optional(Type.Array(Type.Unsafe({ type: ["string", "number", "boolean", "null"] }), {' `
    -Label 'pi-lens lsp_navigation schema'

exit 0
