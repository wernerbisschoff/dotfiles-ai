#!/usr/bin/env bash
# Standalone bootstrap for the dotfiles-ai chezmoi repository (AI agents,
# skills, prompts, extensions, themes). Installs mise + chezmoi if missing,
# arranges this repo at ~/.local/share/chezmoi-ai, and applies it. Idempotent.
#
# Usage (private repo — clone once over SSH, then run this file locally):
#   git clone git@github.com:wernerbisschoff/dotfiles-ai.git ~/.local/share/chezmoi-ai && ~/.local/share/chezmoi-ai/bootstrap.sh
# If this directory already exists, just run ./bootstrap.sh (no second clone).

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

# mise (installs chezmoi; also provides the AI toolchain via .mise.toml)
if ! has mise; then
	log_info "Installing mise..."
	curl https://mise.jdx.dev/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
if has mise; then
	eval "$(mise activate bash)"
fi

# chezmoi (required for apply)
if ! has chezmoi; then
	log_info "Installing chezmoi via mise..."
	mise install chezmoi@latest
fi

# Clone this repo to the expected source dir if not present.
AI_SRC="$HOME/.local/share/chezmoi-ai"
if [[ ! -d "$AI_SRC/.git" ]]; then
	log_info "Cloning wernerbisschoff/dotfiles-ai..."
	git clone https://github.com/wernerbisschoff/dotfiles-ai.git "$AI_SRC"
fi

# Apply the AI repo (renders ~/.claude, ~/.gemini, ~/.pi, ~/.factory, ...).
log_info "Applying chezmoi from wernerbisschoff/dotfiles-ai..."
chezmoi -S "$AI_SRC" apply

log_success "dotfiles-ai setup complete — restart your shell or run: exec zsh"