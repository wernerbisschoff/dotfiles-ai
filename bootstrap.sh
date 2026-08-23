#!/usr/bin/env bash
# Bootstrap script for the dotfiles-ai chezmoi repository (AI agents, skills,
# prompts, extensions, themes). Assumes mise + chezmoi are already installed —
# run the main dotfiles bootstrap first (§6 bootstrap ordering). Idempotent.
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

has mise || { echo "mise missing — run the main dotfiles bootstrap first"; exit 1; }
has chezmoi || { echo "chezmoi missing — run the main dotfiles bootstrap first"; exit 1; }

export PATH="$HOME/.local/bin:$PATH"
eval "$(mise activate bash)"

# Install the AI toolchain (pi, herdr, hunk) per [tools] in .mise.toml.
log_info "Installing AI toolchain via mise..."
mise install

# Apply the AI repo (renders ~/.claude, ~/.gemini, ~/.pi, ~/.factory, ...).
log_info "Applying chezmoi from wernerbisschoff/dotfiles-ai..."
chezmoi -S "$HOME/.local/share/chezmoi-ai" apply

log_success "dotfiles-ai setup complete — restart your shell or run: exec zsh"