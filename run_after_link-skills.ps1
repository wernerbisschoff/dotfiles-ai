#Requires -Version 5.1
<#
.SYNOPSIS
    Link the shared agent skill corpus into tool-specific directories (Windows).

.DESCRIPTION
    The POSIX repos use `symlink_` chezmoi targets for `.pi/agent/skills` and
    `.codex/skills`. Windows needs SeCreateSymbolicLinkPrivilege for those, which
    is only granted with Developer Mode or an elevated shell - and a failing
    symlink aborts the whole chezmoi apply. NTFS junctions have no such
    requirement, so this script creates them after apply instead.

    `.pi/agent/skills` is belt-and-braces: pi reads `~/.agents/skills` natively.
    `.codex/skills` is required for Codex to see the same corpus.
#>
$ErrorActionPreference = 'Stop'

$HomeDir = [Environment]::GetFolderPath('UserProfile')
$source = Join-Path $HomeDir '.agents\skills'

if (-not (Test-Path -LiteralPath $source)) {
    Write-Output "[SKIP] $source does not exist yet"
    exit 0
}

foreach ($relative in @('.pi\agent\skills', '.codex\skills')) {
    $link = Join-Path $HomeDir $relative
    $parent = Split-Path -Parent $link

    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    if (Test-Path -LiteralPath $link) {
        $item = Get-Item -LiteralPath $link -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Output "[OK] $relative already linked"
        }
        else {
            Write-Warning "$relative exists and is a real directory - leaving it alone"
        }
        continue
    }

    New-Item -ItemType Junction -Path $link -Target $source | Out-Null
    Write-Output "[OK] $relative -> $source"
}

exit 0
