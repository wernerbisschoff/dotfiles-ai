#!/usr/bin/env bash
# Shared utility library for path suggestion functions
# Purpose: Provide reusable fuzzy matching and suggestion logic across hooks
# Dependencies: find (for directory search)

# Suggest similar file paths based on fuzzy matching
# Usage: suggest_similar_files <target_path> <search_dir> <max_results>
# Returns: List of similar files (one per line)
suggest_similar_files() {
    local target_path="$1"
    local search_dir="$2"
    local max_results="${3:-3}"

    if [[ ! -d "$search_dir" ]]; then
        return 0
    fi

    local filename
    filename=$(basename "$target_path")

    # Find similar files using case-insensitive matching
    find "$search_dir" -maxdepth 1 -iname "*${filename}*" 2>/dev/null | head -n "$max_results"
}

# Suggest similar directory paths based on fuzzy matching
# Usage: suggest_similar_directories <target_dir> <parent_dir> <max_results>
# Returns: List of similar directories (one per line)
suggest_similar_directories() {
    local target_dir="$1"
    local parent_dir="$2"
    local max_results="${3:-3}"

    if [[ ! -d "$parent_dir" ]]; then
        return 0
    fi

    local target_name
    target_name=$(basename "$target_dir")

    # Find similar directories using case-insensitive matching
    find "$parent_dir" -maxdepth 1 -type d -iname "*${target_name}*" 2>/dev/null | head -n "$max_results"
}

# Check for common file extension case mismatches
# Usage: check_extension_variants <dirname> <base_name> <extension>
# Returns: Suggests correct case if found, otherwise nothing
check_extension_variants() {
    local dirname="$1"
    local base="$2"
    local ext="$3"

    # Try uppercase extension
    if [[ -f "${dirname}/${base}.${ext^^}" ]]; then
        echo "${dirname}/${base}.${ext^^}"
    # Try lowercase extension
    elif [[ -f "${dirname}/${base}.${ext,,}" ]]; then
        echo "${dirname}/${base}.${ext,,}"
    fi
}

# Format suggestions for display
# Usage: format_suggestions <header_text> <suggestions_list>
# Returns: Formatted output with emoji and proper indentation
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
