#!/bin/bash
# Raise the ACP summary output budget in billion-context-pi-lean.
#
# Upstream (checked in 0.2.3 and 0.3.0) budgets every summary at
# ceil(summaryMaxChars / 3) tokens — 6667 by default — and calls
# complete() with no reasoning level. Reasoning models spend that budget
# thinking, so large ranges fail with "compression model hit its output
# limit" and idle auto-compaction (which cannot pass summaryMaxChars)
# degrades to the 1-2 sentence caller fallback every time.
#
# `compress.maxSummaryLength` in acp.json does not help: it only validates
# the finished summary, never the generation budget.
#
# The patch raises the ceiling (still 3x the char budget, capped at
# 32768) so reasoning has headroom. Returned summaries stay bounded by
# the existing maxSummaryLength validator, so nothing longer gets through.
#
# Runs on every apply (run_after_, like upgrade-ai-mise-tools.sh) so it
# survives package updates. Pi loads the file at startup — restart pi.
set -u

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

target="$HOME/.pi/agent/npm/node_modules/billion-context-pi-lean/dist/index.js"
original='  const maxTokens = Math.max(256, Math.ceil((input.summaryMaxChars ?? 2e4) / 3));'
patched='  const maxTokens = Math.min(32768, Math.max(8192, Math.ceil((input.summaryMaxChars ?? 2e4) / 3) * 3));'

[[ -f "$target" ]] || exit 0

# Already patched.
grep -qF "$patched" "$target" && exit 0

if ! grep -qF "$original" "$target"; then
	log_warn "billion-context-pi-lean summary budget line not found — patch skipped (upstream changed it?)"
	exit 0
fi

TARGET="$target" ORIGINAL="$original" PATCHED="$patched" perl -i -pe \
	'BEGIN { $o = $ENV{ORIGINAL}; $p = $ENV{PATCHED} } s/\Q$o\E/$p/' "$target" || {
	log_warn "could not write $target — patch skipped"
	exit 0
}

if grep -qF "$patched" "$target"; then
	log_success "Patched ACP summary budget (restart pi to load it)"
else
	log_warn "patch did not take effect in $target"
fi
exit 0
