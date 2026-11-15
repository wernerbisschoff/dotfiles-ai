#Requires -Version 5.1
<#
.SYNOPSIS
    Standalone Windows bootstrap for the dotfiles-ai chezmoi repository.

.DESCRIPTION
    Installs mise + chezmoi if missing, arranges this repo at
    %USERPROFILE%\.local\share\chezmoi-ai, and applies it. Idempotent.

    Usage:
      git clone https://github.com/wernerbisschoff/dotfiles-ai.git $HOME\.local\share\chezmoi-ai
      $HOME\.local\share\chezmoi-ai\bootstrap.ps1

    The .sh twins are excluded on Windows by .chezmoiignore; the .ps1 ports run
    instead. Skill directories are linked by run_after_link-skills.ps1 using
    NTFS junctions, which need no elevated privilege.
#>
$ErrorActionPreference = 'Stop'

function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Ok { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Test-Command { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# --- execution policy --------------------------------------------------------
# chezmoi run scripts, the shell profile, and the install scripts are all .ps1,
# which Windows blocks under the client default Restricted. CurrentUser scope
# needs no elevation.
$userPolicy = Get-ExecutionPolicy -Scope CurrentUser
if ($userPolicy -in 'Undefined', 'Restricted') {
    Write-Info "Setting CurrentUser execution policy to RemoteSigned (was $userPolicy)..."
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
}

$HomeDir = [Environment]::GetFolderPath('UserProfile')

# --- mise (installs chezmoi; also provides the AI toolchain) ----------------
if (-not (Test-Command 'mise')) {
    Write-Info 'Installing mise...'
    if (Test-Command 'winget') {
        & winget install --id jdx.mise --exact --source winget --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
    }
    if (-not (Test-Command 'mise')) {
        Write-Info 'Falling back to the mise install script...'
        Invoke-RestMethod https://mise.run | Invoke-Expression
    }
    # winget/mise install to a new PATH entry that this process has not seen yet.
    $env:PATH = "$env:LOCALAPPDATA\mise\bin;$env:LOCALAPPDATA\mise\shims;$HOME\.local\bin;$env:PATH"
}

if (-not (Test-Command 'mise')) {
    throw 'mise is not on PATH - open a new shell and re-run this script.'
}

& mise activate pwsh | Out-String | Invoke-Expression
Write-Ok "mise $(& mise --version)"

# --- chezmoi -----------------------------------------------------------------
if (-not (Test-Command 'chezmoi')) {
    Write-Info 'Installing chezmoi via mise...'
    & mise use -g chezmoi@latest
}

# --- clone -------------------------------------------------------------------
$sourceDir = Join-Path $HomeDir '.local\share\chezmoi-ai'
if (-not (Test-Path -LiteralPath (Join-Path $sourceDir '.git'))) {
    if (-not (Test-Command 'git')) {
        throw 'git is not installed - run: winget install Git.Git'
    }
    Write-Info 'Cloning wernerbisschoff/dotfiles-ai...'
    $parent = Split-Path -Parent $sourceDir
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    & git clone https://github.com/wernerbisschoff/dotfiles-ai.git $sourceDir
}

# --- apply -------------------------------------------------------------------
Write-Info 'Applying chezmoi from wernerbisschoff/dotfiles-ai...'
& mise x chezmoi -- chezmoi -S $sourceDir apply
if ($LASTEXITCODE -ne 0) {
    throw "chezmoi apply failed with exit code $LASTEXITCODE"
}

Write-Ok 'dotfiles-ai setup complete - restart your shell to load profile changes.'
