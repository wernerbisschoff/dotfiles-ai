#!/bin/bash
# Install herdr-hunk-diff after mise has herdr/hunk.
# Re-runs when this script content changes (run_once_after_).
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

PLUGIN_SPEC="jhochenbaum/herdr-hunk-diff"
PLUGIN_ID="jhochenbaum.hunkdiff"

if has mise; then
	eval "$(mise activate bash)"
fi

if ! has herdr; then
	log_warn "herdr not on PATH — skipping $PLUGIN_SPEC"
	exit 0
fi

plugin_installed() {
	if herdr plugin list --json 2>/dev/null | grep -Fq "$PLUGIN_ID"; then
		return 0
	fi
	herdr plugin list 2>/dev/null | grep -Fq "$PLUGIN_ID"
}

if plugin_installed; then
	echo "  → $PLUGIN_ID already installed"
	exit 0
fi

log_info "Installing $PLUGIN_SPEC..."
herdr plugin install "$PLUGIN_SPEC" --yes
log_success "$PLUGIN_ID installed"
