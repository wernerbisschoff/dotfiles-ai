#!/bin/bash
# Register the AI toolchain (pi, herdr, hunk) as GLOBAL mise tools and install
# them. Runs once per content hash (run_once_after_).
#
# Why: `pi` is not pinned in [tools] (this repo). ~/.config/mise/config.toml
# is owned by the MAIN dotfiles repo and no longer declares AI tools. This
# script re-asserts pi/herdr/hunk globally so their shims stay available
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

if ! has mise; then
	log_info "mise not installed — skipping global AI tool registration"
	exit 0
fi

eval "$(mise activate bash)"

mise use -g pi@latest herdr@latest hunk@latest
mise install

log_success "AI mise tools registered globally (pi, herdr, hunk)"