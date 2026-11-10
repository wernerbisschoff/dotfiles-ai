#!/usr/bin/env bash
# Regression test, not a second commit implementation. Run: bash .chezmoitemplates/tests/commit-helper.sh
# Calls the production helper in a temporary repository; never commits this repository's changes.
set -euo pipefail
helper="$(cd "$(dirname "$0")/../.." && pwd)/dot_agents/skills/commit/executable_commit.sh.tmpl"
workspace=$(mktemp -d)
trap 'rm -r -- "$workspace"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export TMPDIR="$workspace"
cd "$workspace"
git init -q repo
cd repo
git config user.name Test
git config user.email test@example.invalid
printf 'base\n' > a
printf 'base\n' > b
git add a b
git commit -qm initial
plan() {
    contract=$(bash "$helper" pre)
    PLAN_TARGET=$(printf '%s' "$contract" | jq -r '.plan_target')
    export PLAN_TARGET
    jq -n --arg mode "$1" --argjson files "$2" \
        '{mode: $mode, files: $files, message: "fix: test"}' > "$PLAN_TARGET"
}
reject() {
    if bash "$helper" post > "$workspace/output" 2>&1; then
        echo "Expected rejection" >&2
        exit 1
    fi
}
printf 'staged\n' > a
git add a
printf 'unstaged\n' >> a
printf 'unrelated\n' > b
git add b
plan staged '["a"]'
reject
[[ "$(git rev-list --count HEAD)" == 1 ]]
plan staged '["a","b"]'
bash "$helper" post >/dev/null
[[ "$(git show HEAD:a)" == staged ]]
[[ "$(cat a)" == $'staged\nunstaged' ]]
# A failed hook must retain the plan and must not create a commit.
printf '#!/bin/sh\nexit 1\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
plan worktree '["a"]'
reject
[[ -f "$PLAN_TARGET" ]]
[[ "$(git rev-list --count HEAD)" == 2 ]]
[[ -n "$(git diff --cached --name-only)" ]]
# The old worktree plan cannot run against the newly staged index.
reject
printf '#!/bin/sh\nexit 0\n' > .git/hooks/pre-commit
plan staged '["a"]'
bash "$helper" post >/dev/null
# Exact path handling includes deletions and pathspec metacharacters.
printf 'literal\n' > 'x[1]'
printf 'other\n' > x1
rm b
plan worktree '["b","x[1]"]'
bash "$helper" post >/dev/null
[[ "$(git show 'HEAD:x[1]')" == literal ]]
if git cat-file -e HEAD:b 2>/dev/null || git cat-file -e HEAD:x1 2>/dev/null; then
    echo "Commit included an unexpected path" >&2
    exit 1
fi
printf 'Commit helper checks passed\n'
