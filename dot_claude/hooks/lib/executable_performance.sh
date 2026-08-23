#!/usr/bin/env bash
# Shared utility library for performance logging functions
# Purpose: Provide optional performance tracking for hook execution
# Environment: CLAUDE_HOOK_DEBUG=1 to enable performance logging

# Initialize performance tracking if debug mode is enabled
# Usage: init_performance_tracking
# Sets up a trap to log execution time on exit
init_performance_tracking() {
    if [[ "${CLAUDE_HOOK_DEBUG:-0}" == "1" ]]; then
        # Get start time in nanoseconds
        HOOK_START_TIME=$(date +%s%N 2>/dev/null || echo "0")

        # Set trap to log execution time on exit
        trap 'log_performance' EXIT
    fi
}

# Log performance information
# Usage: log_performance
# Outputs execution time to stderr if debug mode is enabled
log_performance() {
    if [[ "${CLAUDE_HOOK_DEBUG:-0}" == "1" ]] && [[ -n "${HOOK_START_TIME:-}" ]]; then
        # Get end time in nanoseconds
        HOOK_END_TIME=$(date +%s%N 2>/dev/null || echo "0")

        # Calculate duration in milliseconds
        if [[ "$HOOK_START_TIME" != "0" ]] && [[ "$HOOK_END_TIME" != "0" ]]; then
            HOOK_DURATION_MS=$(( (HOOK_END_TIME - HOOK_START_TIME) / 1000000 ))
            echo "[PERF] $(basename "$0") executed in ${HOOK_DURATION_MS}ms" >&2
        fi
    fi
}

# Log a specific checkpoint within a hook
# Usage: log_checkpoint <checkpoint_name>
# Outputs timestamped checkpoint to stderr if debug mode is enabled
log_checkpoint() {
    local checkpoint_name="$1"
    if [[ "${CLAUDE_HOOK_DEBUG:-0}" == "1" ]]; then
        local checkpoint_time
        checkpoint_time=$(date +%s%N 2>/dev/null || echo "0")
        echo "[PERF] Checkpoint: ${checkpoint_name} at ${checkpoint_time}ns" >&2
    fi
}
