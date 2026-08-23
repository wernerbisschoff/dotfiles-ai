#!/usr/bin/env bash
# Hook: Validate git state before destructive operations
# Purpose: Prevent accidental data loss from force pushes, clean operations, etc.
# Benefit: Protects work, provides safety checks for dangerous git commands
# Shell: bash 4.0+ (uses associative arrays, pattern matching)
# Dependencies: jq (for JSON parsing), git (for state checking)
# Exit codes: 0=allow/warn, 1=deny (validation failure), 2=system error

set -euo pipefail

# Source performance utilities
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
if [[ -f "$LIB_DIR/performance.sh" ]]; then
    # shellcheck source=lib/performance.sh
    source "$LIB_DIR/performance.sh"
    init_performance_tracking
fi

# Extract command from tool input
command=$(echo "${CLAUDE_TOOL_INPUT:-}" | jq -r '.command // empty')

if [[ -z "$command" ]]; then
    exit 0
fi

# Define dangerous patterns
dangerous_patterns=(
    "git push.*--force"
    "git push.*-f"
    "git reset --hard"
    "git clean.*-fd"
    "git clean.*-fx"
    "rm -rf"
    "rm -fr"
)

# Check if command matches any dangerous pattern
for pattern in "${dangerous_patterns[@]}"; do
    if [[ "$command" =~ $pattern ]]; then
        echo "⚠️  Potentially destructive command detected:" >&2
        echo "   $command" >&2
        echo "" >&2

        # Provide context-specific warnings
        case "$pattern" in
            "git push.*--force"|"git push.*-f")
                echo "Risk: Overwriting remote history, losing commits" >&2
                echo "" >&2
                echo "💡 Safer alternatives:" >&2
                echo "   - git push --force-with-lease (respects remote changes)" >&2
                echo "   - git revert (create new commit to undo changes)" >&2
                ;;
            "git reset --hard")
                echo "Risk: Discarding uncommitted work permanently" >&2
                echo "" >&2
                echo "💡 Before resetting, consider:" >&2
                echo "   - git stash (save uncommitted changes)" >&2
                echo "   - git status (check what will be lost)" >&2
                ;;
            "git clean.*-fd"|"git clean.*-fx")
                echo "Risk: Deleting untracked files and directories" >&2
                echo "" >&2
                echo "💡 Safer alternatives:" >&2
                echo "   - git clean -fdn (dry-run first to see what will be deleted)" >&2
                echo "   - git clean -fdi (interactive mode)" >&2
                ;;
            "rm -rf"|"rm -fr")
                echo "Risk: Permanent deletion of files/directories" >&2
                echo "" >&2
                echo "💡 Before deleting, verify:" >&2
                echo "   - ls -la (check directory contents)" >&2
                echo "   - pwd (verify current directory)" >&2
                ;;
        esac

        echo "" >&2
        echo "To proceed, re-run the command without hooks or confirm you understand the risk." >&2
        exit 1  # Deny operation: validation failed
    fi
done

# Additional check: warn about git operations with uncommitted changes
if [[ "$command" =~ ^(git switch|git checkout|git merge|git rebase|git pull) ]]; then
    if git rev-parse --git-dir > /dev/null 2>&1; then
        if ! git diff-index --quiet HEAD -- 2>/dev/null; then
            echo "⚠️  You have uncommitted changes:" >&2
            git status --short >&2
            echo "" >&2
            echo "💡 Consider:" >&2
            echo "   - git stash (save changes temporarily)" >&2
            echo "   - git commit (commit changes first)" >&2
            echo "" >&2
            echo "Proceeding may cause conflicts or lose work." >&2
            # Don't deny, just warn (exit 0)
        fi
    fi
fi

exit 0  # Allow the operation
