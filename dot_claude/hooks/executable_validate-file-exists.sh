#!/usr/bin/env bash
# Hook: Validate file existence before Read operations
# Purpose: Prevent wasted tokens and failed reads by checking if file exists first
# Benefit: Saves time, reduces context noise, provides helpful suggestions
# Shell: bash 4.0+ (uses parameter expansion, case statements)
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
    suggest_similar_files() {
        local target_path="$1"
        local search_dir="$2"
        local max_results="${3:-3}"
        [[ -d "$search_dir" ]] || return 0
        local filename
        filename=$(basename "$target_path")
        find "$search_dir" -maxdepth 1 -iname "*${filename}*" 2>/dev/null | head -n "$max_results"
    }

    check_extension_variants() {
        local dirname="$1"
        local base="$2"
        local ext="$3"
        if [[ -f "${dirname}/${base}.${ext^^}" ]]; then
            echo "${dirname}/${base}.${ext^^}"
        elif [[ -f "${dirname}/${base}.${ext,,}" ]]; then
            echo "${dirname}/${base}.${ext,,}"
        fi
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

if [[ -z "$file_path" ]]; then
    exit 0  # No file path provided, let it fail naturally
fi

# Check if file exists
if [[ ! -f "$file_path" ]]; then
    echo "❌ File not found: $file_path" >&2

    # Try to find similar files using shared utility
    filename=$(basename "$file_path")
    dirname=$(dirname "$file_path")

    # Check for similar files in same directory
    if [[ -d "$dirname" ]]; then
        similar=$(suggest_similar_files "$file_path" "$dirname")
        format_suggestions "Similar files found" "$similar"
    fi

    # Check for common typos (wrong extension, case sensitivity)
    if [[ "$filename" =~ \.[a-z]+$ ]]; then
        base="${filename%.*}"
        ext="${filename##*.}"

        # Check extension variants
        variant=$(check_extension_variants "$dirname" "$base" "$ext")
        if [[ -n "$variant" ]]; then
            echo "" >&2
            echo "💡 Did you mean: $variant" >&2
        fi
    fi

    exit 1  # Deny operation: validation failed
fi

exit 0  # Allow the operation
