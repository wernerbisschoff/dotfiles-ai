#!/bin/bash
# Piolium 0.0.15 resolves bundled Sonnet/Opus preferences across providers,
# overriding the active Pi model and potentially selecting a separately billed
# provider. Keep audit children on the parent model instead. Reapplied by
# patch-pi after managed package updates; restart Pi to load the change.
set -eu

target="$HOME/.pi/agent/npm/node_modules/@vigolium/piolium/extensions/piolium/agent-runner.ts"
original='const resolvedModel = resolveAgentModel(options.agent.model, options.model, options.modelRegistry);'
patched='const resolvedModel = options.model;'
[[ -f "$target" ]] || exit 0

grep -qF "$patched" "$target" && exit 0
if ! grep -qF "$original" "$target"; then
    echo "[WARN] Piolium model selection line not found; patch skipped (upstream changed it?)" >&2
    exit 0
fi

TARGET="$target" ORIGINAL="$original" PATCHED="$patched" perl -i -pe \
    'BEGIN { $o = $ENV{ORIGINAL}; $p = $ENV{PATCHED} } s/\Q$o\E/$p/' "$target"
grep -qF "$patched" "$target"
echo "[OK] Patched Piolium to inherit the active Pi model (restart Pi to load it)"
