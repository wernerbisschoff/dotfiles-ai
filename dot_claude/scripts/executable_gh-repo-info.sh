#!/usr/bin/env bash
# Set OWNER and REPO variables from current git repository
# This script auto-detects GitHub owner/repo from git remote
#
# Usage:
#   source ~/.claude/scripts/gh-repo-info.sh
#   Or in scripts: eval "$(gh-repo-info.sh)"

set -e

# Only run if we're in a git directory with gh available
if git rev-parse --git-dir > /dev/null 2>&1 && command -v gh > /dev/null 2>&1; then
  # Check if this repo has a GitHub remote
  if git remote get-url origin > /dev/null 2>&1; then
    # Get owner and repo from gh CLI (auto-inferred from git remote)
    REPO_INFO=$(gh repo view --json owner,name --jq '.owner.login + " " + .name' 2>/dev/null || true)

    if [[ -n "$REPO_INFO" ]]; then
      OWNER=$(echo "$REPO_INFO" | cut -d' ' -f1)
      REPO=$(echo "$REPO_INFO" | cut -d' ' -f2)

      # Export variables if sourced, otherwise print for eval
      if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
        export OWNER REPO
      else
        echo "export OWNER=\"$OWNER\""
        echo "export REPO=\"$REPO\""
      fi
    fi
  fi
fi
