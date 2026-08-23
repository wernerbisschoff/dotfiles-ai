#!/usr/bin/env bash
# Hook: Warn about large file reads to optimize context usage
# Purpose: Alert when reading large files that could be summarized or compressed
# Benefit: Reduces token costs, improves response time, encourages efficient context usage
# Shell: bash 4.0+ (uses case statements, arithmetic)
# Dependencies: jq (for JSON parsing), wc (for file size)
# Exit codes: 0=allow/warn, 1=deny (file too large), 2=system error
# Environment: CLAUDE_FILE_SIZE_WARNING_KB, CLAUDE_FILE_SIZE_ERROR_MB

set -euo pipefail

# Source performance utilities
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
if [[ -f "$LIB_DIR/performance.sh" ]]; then
    # shellcheck source=lib/performance.sh
    source "$LIB_DIR/performance.sh"
    init_performance_tracking
fi

# Extract file path from tool input
file_path=$(echo "${CLAUDE_TOOL_INPUT:-}" | jq -r '.file_path // empty')
tool_name=$(echo "${CLAUDE_TOOL_INPUT:-}" | jq -r '.tool_name // empty')

# Only check Read operations
if [[ "$tool_name" != "Read" ]]; then
    exit 0
fi

if [[ -z "$file_path" ]]; then
    exit 0
fi

# Check if file exists
if [[ ! -f "$file_path" ]]; then
    exit 0  # Let the file existence hook handle this
fi

# Get file size in bytes
file_size=$(wc -c < "$file_path" 2>/dev/null || echo 0)
file_size_kb=$((file_size / 1024))
file_size_mb=$((file_size / 1024 / 1024))

# Get line count
line_count=$(wc -l < "$file_path" 2>/dev/null || echo 0)

# Define thresholds (configurable via environment variables)
SIZE_WARNING_KB=${CLAUDE_FILE_SIZE_WARNING_KB:-500}   # Default: 500 KB
SIZE_ERROR_MB=${CLAUDE_FILE_SIZE_ERROR_MB:-5}         # Default: 5 MB

# Warning for large files
if [[ $file_size_kb -gt $SIZE_WARNING_KB ]]; then
    echo "⚠️  Large file detected:" >&2
    echo "   File: $file_path" >&2
    echo "   Size: ${file_size_kb} KB (${file_size_mb} MB)" >&2
    echo "   Lines: $line_count" >&2
    echo "" >&2

    # Provide context-specific suggestions
    if [[ $file_size_mb -ge $SIZE_ERROR_MB ]]; then
        echo "❌ This file is very large and may consume significant tokens." >&2
        echo "" >&2
        echo "💡 Consider:" >&2
        echo "   1. Reading specific sections using Read tool with offset/limit" >&2
        echo "   2. Using Grep tool to search for specific patterns" >&2
        echo "   3. Summarizing the file manually and reading only relevant sections" >&2
        echo "   4. Creating a condensed reference document instead" >&2
        exit 1  # Deny operation: file too large
    else
        echo "💡 Optimization tips:" >&2
        echo "   - Read only the sections you need using offset/limit parameters" >&2
        echo "   - Use Grep to search for specific content instead of reading entire file" >&2
        echo "   - Consider if you really need the entire file or just key sections" >&2
        echo "" >&2
        echo "Proceeding with read operation..." >&2
        # Don't deny, just warn (exit 0)
    fi
fi

# Check for common large file patterns
case "$file_path" in
    *.log|*.min.js|*.min.css|package-lock.json|yarn.lock|Podfile.lock)
        echo "⚠️  This file type is typically not human-readable or useful:" >&2
        echo "   $file_path" >&2
        echo "" >&2
        echo "💡 Consider:" >&2
        case "$file_path" in
            *.log)
                echo "   - Using tail/head to read recent entries" >&2
                echo "   - Using grep to search for specific errors" >&2
                ;;
            *.min.js|*.min.css)
                echo "   - Reading the source version instead" >&2
                echo "   - Using a formatter to prettify first" >&2
                ;;
            package-lock.json|yarn.lock|Podfile.lock)
                echo "   - These are auto-generated and rarely need manual inspection" >&2
                echo "   - Use package.json or Podfile instead" >&2
                ;;
        esac
        echo "" >&2
        echo "Proceeding with read operation..." >&2
        ;;
esac

exit 0  # Allow the operation
