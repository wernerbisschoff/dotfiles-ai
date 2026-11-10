#!/bin/bash
# Give pi-lens's `lsp_navigation` parameter schema a concrete `items` type.
#
# Upstream 4.4.11 (and every earlier release) declares
# `commandArguments: Type.Array(Type.Unknown())`, which serialises to
# {"type":"array","items":{}}. OpenAI-compatible upstreams validate every
# schema node and reject the tool list with `invalid_function_parameters`:
# "schema must have a 'type' key" for that `items`. The rejection is fatal
# for any request that carries the full tool list, including ACP summaries,
# even though the summary itself never calls a tool.
#
# Unsafe is the only typebox constructor that keeps "any JSON value" while
# emitting a `type` key; Type.Any()/Type.Unknown() serialise to {} again.
# The list stays scalar-only: a scalar `type` array needs no extra keywords,
# while object/array branches require `additionalProperties: false` and
# `items`, which those branches would not carry.
#
# Runs on every apply (run_after_, like upgrade-ai-mise-tools.sh) so it
# survives package updates. Pi loads the file at startup — restart pi.
set -u

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

target="$HOME/.pi/agent/npm/node_modules/pi-lens/dist/index.js"
original='commandArguments: Type.Optional(Type.Array(Type.Unknown(), {'
patched='commandArguments: Type.Optional(Type.Array(Type.Unsafe({ type: ["string", "number", "boolean", "null"] }), {'
[[ -f "$target" ]] || exit 0

# Already patched.
grep -qF "$patched" "$target" && exit 0

if ! grep -qF "$original" "$target"; then
	log_warn "pi-lens lsp_navigation schema line not found — patch skipped (upstream changed it?)"
	exit 0
fi

TARGET="$target" ORIGINAL="$original" PATCHED="$patched" perl -i -pe \
	'BEGIN { $o = $ENV{ORIGINAL}; $p = $ENV{PATCHED} } s/\Q$o\E/$p/' "$target" || {
	log_warn "could not write $target — patch skipped"
	exit 0
}

if grep -qF "$patched" "$target"; then
	log_success "Patched pi-lens lsp_navigation schema (restart pi to load it)"
else
	log_warn "patch did not take effect in $target"
fi
exit 0
