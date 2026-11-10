#!/bin/bash
# Install plannotator (binary only) and the herdr-annotate plugin.
# Re-runs when this script content changes (run_once_after_).
#
# Minimal install keeps agent wiring in chezmoi: pi setup lives in
# dot_pi/agent/settings.json (packages), herdr wiring in
# dot_config/herdr/plugins/plannotator-review/.
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

if has mise; then
	eval "$(mise activate bash)"
fi

if has plannotator; then
	echo "  → plannotator already installed ($(plannotator --version 2>/dev/null || echo unknown))"
else
	log_info "Installing plannotator (minimal: binary only)..."
	curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
	log_success "plannotator installed"
fi

PLUGIN_REPO="plannotator/herdr-annotate"
if ! has herdr; then
	log_warn "herdr not on PATH — skipping $PLUGIN_REPO"
	exit 0
fi

if herdr plugin list --json 2>/dev/null | grep -Fq '"repo":"herdr-annotate"'; then
	echo "  → $PLUGIN_REPO already installed"
else
	log_info "Installing $PLUGIN_REPO..."
	herdr plugin install "$PLUGIN_REPO" --yes
	log_success "$PLUGIN_REPO installed"
fi

PI_EXT="npm:@plannotator/pi-extension"
if has pi; then
	if pi list 2>/dev/null | grep -Fq "$PI_EXT"; then
		echo "  → $PI_EXT already installed"
	else
		log_info "Installing $PI_EXT..."
		pi install "$PI_EXT"
		log_success "$PI_EXT installed"
	fi
else
	log_warn "pi not on PATH — skipping $PI_EXT"
fi

LOCAL_PLUGIN="$HOME/.config/herdr/plugins/plannotator-review"
if [[ -d "$LOCAL_PLUGIN" ]]; then
	if herdr plugin list --json 2>/dev/null | grep -Fq '"plugin_id":"local.plannotator-review"'; then
		echo "  → local.plannotator-review already linked"
	else
		log_info "Linking local.plannotator-review..."
		herdr plugin link "$LOCAL_PLUGIN"
		log_success "local.plannotator-review linked"
	fi
fi
