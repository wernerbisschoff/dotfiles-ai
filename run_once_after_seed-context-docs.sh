#!/bin/bash
# Pre-seed @wernerbisschoff/libref documentation packages — runs once (content-tracked via run_once_after_).
# Re-runs when content changes (e.g., adding new packages or updating versions).
# Registry packages use `libref install <registry/name>`.
# Git-origin packages use `libref add <git-url> --path <docs-path>`.

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
has() { command -v "$1" &>/dev/null; }

if ! has libref; then
	log_warn "libref CLI not installed — install with: npm i -g @wernerbisschoff/libref"
	exit 0
fi

# =============================================================================
# Python ecosystem
# =============================================================================

seed_python() {
	log_info "Seeding Python docs..."

	if has pip; then
		if libref install pip/fastapi 2>/dev/null; then log_success "  FastAPI"; else log_warn "  FastAPI failed"; fi
		if libref install pip/django 2>/dev/null; then log_success "  Django"; else log_warn "  Django failed"; fi
		if libref install pip/pydantic 2>/dev/null; then log_success "  Pydantic"; else log_warn "  Pydantic failed"; fi
		if libref install pip/flask 2>/dev/null; then log_success "  Flask"; else log_warn "  Flask failed"; fi
	else
		log_warn "  pip not found — skipping Python packages"
	fi
}

# =============================================================================
# Frontend ecosystem (JavaScript/TypeScript)
# =============================================================================

seed_frontend() {
	log_info "Seeding frontend docs..."

	if libref install npm/react 2>/dev/null; then log_success "  React"; else log_warn "  React failed"; fi
	if libref install npm/next 2>/dev/null; then log_success "  Next.js"; else log_warn "  Next.js failed"; fi
	if libref install npm/typescript 2>/dev/null; then log_success "  TypeScript"; else log_warn "  TypeScript failed"; fi
	if libref install npm/tailwind 2>/dev/null; then log_success "  Tailwind CSS"; else log_warn "  Tailwind CSS failed"; fi
}

# =============================================================================
# Elixir ecosystem (git source — no registry yet)
# =============================================================================

seed_elixir() {
	log_info "Seeding Elixir ecosystem docs..."

	# Elixir core — docs embedded in source files
	if libref add https://github.com/elixir-lang/elixir/tree/v1.20-latest --name elixir 2>/dev/null; then
		log_success "  Elixir"
	else
		log_warn "  Elixir failed"
	fi

	# Phoenix — hexdocs website (libref follows sitemap → 811 sections)
	if libref add https://phoenix.hexdocs.pm/ 2>/dev/null; then
		log_success "  Phoenix"
	else
		log_warn "  Phoenix failed"
	fi

	# LiveView — hexdocs website (libref follows llms.txt → 441 sections)
	if libref add https://phoenix-live-view.hexdocs.pm/ 2>/dev/null; then
		log_success "  Phoenix LiveView"
	else
		log_warn "  Phoenix LiveView failed"
	fi
}

seed_python
seed_frontend
seed_elixir

log_success "Libref doc seeding complete"
