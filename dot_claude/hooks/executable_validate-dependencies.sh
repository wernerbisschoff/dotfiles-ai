#!/usr/bin/env bash
# Hook: Validate dependencies before build/test commands
# Purpose: Ensure required files and dependencies exist before running commands
# Benefit: Prevents confusing build errors, provides clear guidance
# Shell: bash 4.0+ (uses associative arrays, regex matching)
# Dependencies: jq (for JSON parsing)
# Exit codes: 0=allow, 1=deny (validation failure), 2=system error

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

# Check for build/test patterns
if [[ "$command" =~ ^(make|npm run|pnpm run|yarn run|bun run|cargo build|cargo test|go build|python -m pytest) ]]; then
    # Check if we're in a project directory
    if [[ ! -f "Makefile" && ! -f "package.json" && ! -f "Cargo.toml" && ! -f "go.mod" && ! -f "pyproject.toml" ]]; then
        echo "⚠️  No project configuration file found in current directory" >&2
        echo "" >&2
        echo "Current directory: $(pwd)" >&2
        echo "" >&2
        echo "💡 Expected one of:" >&2
        echo "   - Makefile (for make)" >&2
        echo "   - package.json (for npm/pnpm/yarn/bun)" >&2
        echo "   - Cargo.toml (for cargo)" >&2
        echo "   - go.mod (for go)" >&2
        echo "   - pyproject.toml (for python)" >&2
        echo "" >&2
        echo "Verify you're in the correct project directory." >&2
        exit 1  # Deny operation: validation failed
    fi

    # Check for node_modules if it's a node command
    if [[ "$command" =~ ^(npm|pnpm|yarn|bun) ]] && [[ ! -d "node_modules" ]]; then
        echo "⚠️  node_modules directory not found" >&2
        echo "" >&2
        echo "💡 Run install first:" >&2
        if command -v pnpm &> /dev/null; then
            echo "   pnpm install" >&2
        elif command -v bun &> /dev/null; then
            echo "   bun install" >&2
        elif command -v npm &> /dev/null; then
            echo "   npm install" >&2
        fi
        exit 1  # Deny operation: validation failed
    fi

    # Check for Makefile targets
    if [[ "$command" =~ ^make ]] && [[ -f "Makefile" ]]; then
        target=$(echo "$command" | sed 's/make //')

        if [[ -n "$target" ]]; then
            if ! grep -q "^${target}:" Makefile 2>/dev/null; then
                echo "⚠️  Makefile target not found: $target" >&2
                echo "" >&2
                echo "💡 Available targets:" >&2
                grep "^[a-zA-Z_-]*:" Makefile | sed 's/://g' | head -10 >&2
                echo "" >&2
                echo "Run 'make help' or 'make' without arguments to see all targets." >&2
                exit 1  # Deny operation: validation failed
            fi
        fi
    fi

    # Check for npm/pnpm scripts
    if [[ "$command" =~ ^(npm run|pnpm run|yarn run|bun run) ]] && [[ -f "package.json" ]]; then
        script=$(echo "$command" | sed -E 's/^(npm run|pnpm run|yarn run|bun run) //')

        if [[ -n "$script" ]]; then
            if ! jq -e ".scripts[\"$script\"]" package.json > /dev/null 2>&1; then
                echo "⚠️  Script not found in package.json: $script" >&2
                echo "" >&2
                echo "💡 Available scripts:" >&2
                jq -r '.scripts | keys[]' package.json | head -10 >&2
                exit 1  # Deny operation: validation failed
            fi
        fi
    fi
fi

exit 0  # Allow the operation
