#!/bin/bash
# Install npm global packages — runs once (content-tracked via run_once_after_).
# Re-runs when content changes (e.g., adding new packages).
# All entries below install via: npm i -g <package>

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

install_npm_global() {
	local plugin="$1"
	if npm ls -g --depth=0 "$plugin" &>/dev/null; then
		echo "  → $plugin already installed"
	else
		log_info "Installing $plugin..."
		npm install -g "$plugin"
		log_success "$plugin installed"
	fi
}

if ! has npm; then
	log_warn "npm not available — skipping npm global installs"
	exit 0
fi

install_npm_global "open-codebase-index"
install_npm_global "@wernerbisschoff/libref"
