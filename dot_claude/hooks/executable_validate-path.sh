#!/usr/bin/env bash
# Hook: Validate file paths and provide helpful suggestions
# Purpose: Catch path typos, invalid directories, and suggest corrections
# Benefit: Reduces failed operations, provides helpful guidance
# Shell: bash 4.0+ (uses regex matching, pattern matching)
# Dependencies: jq (for JSON parsing)
# Exit codes: 0=allow, 1=deny (validation failure), 2=system error

set -euo pipefail

# Source shared utilities
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
if [[ -f "$LIB_DIR/suggestions.sh" ]]; then
    # shellcheck source=lib/suggestions.sh
    source "$LIB_DIR/suggestions.sh"
else
    # Fallback implementations if library not available
    suggest_similar_directories() {
        local target_dir="$1"
        local parent_dir="$2"
        local max_results="${3:-3}"
        [[ -d "$parent_dir" ]] || return 0
        local target_name
        target_name=$(basename "$target_dir")
        find "$parent_dir" -maxdepth 1 -type d -iname "*${target_name}*" 2>/dev/null | head -n "$max_results"
    }

    format_suggestions() {
        local header="$1"
        local suggestions="$2"
        if [[ -n "$suggestions" ]]; then
            echo "" >&2
            echo "💡 $header:" >&2
            echo "$suggestions" | while read -r suggestion; do
                echo "   - $suggestion" >&2
            done
        fi
    }
fi

# Source performance utilities
if [[ -f "$LIB_DIR/performance.sh" ]]; then
    # shellcheck source=lib/performance.sh
    source "$LIB_DIR/performance.sh"
    init_performance_tracking
fi

# Extract file path from tool input
file_path=$(echo "${CLAUDE_TOOL_INPUT:-}" | jq -r '.file_path // empty')
tool_name=$(echo "${CLAUDE_TOOL_INPUT:-}" | jq -r '.tool_name // empty')

# Only validate paths for file operations
if [[ ! "$tool_name" =~ ^(Read|Write|Edit|MultiEdit)$ ]]; then
    exit 0
fi

if [[ -z "$file_path" ]]; then
    exit 0
fi

# Check if path contains common mistakes
if [[ "$file_path" =~ \.\./\.\./\.\. ]]; then
    echo "⚠️  Path contains multiple parent directory references:" >&2
    echo "   $file_path" >&2
    echo "" >&2
    echo "💡 Consider using absolute paths or restructuring your approach" >&2
    exit 1  # Deny operation: validation failed
fi

# Check for suspicious patterns (double slashes, spaces at edges)
if [[ "$file_path" =~ // ]] || [[ "$file_path" =~ ^\s ]] || [[ "$file_path" =~ \s$ ]]; then
    echo "⚠️  Path contains suspicious patterns:" >&2
    echo "   $file_path" >&2
    echo "" >&2
    echo "💡 Check for:" >&2
    echo "   - Double slashes (//)" >&2
    echo "   - Leading/trailing spaces" >&2
    echo "   - Typos in directory names" >&2
    exit 1  # Deny operation: validation failed
fi

# For Write/Edit operations, check if directory exists
if [[ "$tool_name" =~ ^(Write|Edit|MultiEdit)$ ]]; then
    dir_path=$(dirname "$file_path")

    if [[ ! -d "$dir_path" && "$dir_path" != "." ]]; then
        echo "❌ Directory does not exist: $dir_path" >&2
        echo "" >&2

        # Try to find similar directory names using shared utility
        parent_dir=$(dirname "$dir_path")
        target_dir=$(basename "$dir_path")

        if [[ -d "$parent_dir" ]]; then
            similar=$(suggest_similar_directories "$dir_path" "$parent_dir")
            if [[ -n "$similar" ]]; then
                format_suggestions "Similar directories found" "$similar"
                echo "" >&2
                echo "💡 To create the directory, run:" >&2
                echo "   mkdir -p $dir_path" >&2
            fi
        fi

        exit 1  # Deny operation: validation failed
    fi
fi

exit 0  # Allow the operation
