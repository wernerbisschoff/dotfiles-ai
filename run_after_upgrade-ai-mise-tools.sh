#!/bin/bash
# Upgrade the global AI toolchain (pi, herdr, hunk) on every apply.
# Keeps pi (and friends) current without relying on `pi update`, which
# cannot self-update a mise-managed install.
set -u

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

if ! has mise; then
	exit 0
fi

eval "$(mise activate bash)" 2>/dev/null || true

log_info "Upgrading AI toolchain (pi, herdr, hunk)..."
if mise upgrade --bump npm:@earendil-works/pi-coding-agent herdr hunk; then
	log_success "AI toolchain up to date"
else
	log_warn "AI toolchain upgrade failed; continuing"
fi
exit 0
