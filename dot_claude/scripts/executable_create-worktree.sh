#!/usr/bin/env bash
# Create a new git worktree with a new branch and shared directory symlinks
#
# Usage: create-worktree.sh [--id=TASK_ID] [--skip=N] [worktree-name] [base-branch]
#
# Arguments:
#   --id=TASK_ID    (deprecated) Task ID to fetch details from (e.g., 42)
#   --skip=N        (deprecated) Skip N tasks and use the next one
#   worktree-name   Name/directory/branch for the new worktree (optional, auto-generated from Task-Master if --id/--skip provided)
#   base-branch     Branch to create the new branch FROM (default: main)
#
# Examples:
#   create-worktree.sh --id=42                 # Fetches task 42 details (legacy), creates branch "task-42-..." from "main"
#   create-worktree.sh --skip=2                # Skips 2 tasks, uses next one, creates branch from "main"
#   create-worktree.sh --id=42 develop         # Creates branch from "develop" instead of "main"
#   create-worktree.sh feature/new-ui develop  # Creates branch "feature/new-ui" from "develop"
#   create-worktree.sh my-feature              # Creates branch "my-feature" from "main"
#
# Note: Creates a NEW branch named [worktree-name] based on [base-branch], not a checkout of [base-branch]

set -euo pipefail

# Colors for output
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly RED='\033[0;31m'
readonly NC='\033[0m' # No Color

# Get main repository root (where script is being run from)
MAIN_REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$MAIN_REPO_ROOT" ]]; then
  echo -e "${RED}Error: Not in a git repository${NC}" >&2
  exit 1
fi

# Parse arguments
TASK_ID=""
SKIP_COUNT=""
WORKTREE_NAME=""
BASE_BRANCH="main"

for arg in "$@"; do
  if [[ "$arg" =~ ^--id=(.+)$ ]]; then
    TASK_ID="${BASH_REMATCH[1]}"
  elif [[ "$arg" =~ ^--skip=(.+)$ ]]; then
    SKIP_COUNT="${BASH_REMATCH[1]}"
  elif [[ -z "$WORKTREE_NAME" ]] && [[ ! "$arg" =~ ^-- ]]; then
    WORKTREE_NAME="$arg"
  elif [[ -z "$BASE_BRANCH" ]] || "$BASE_BRANCH" == "main" && [[ ! "$arg" =~ ^-- ]]; then
    BASE_BRANCH="$arg"
  fi
done

# Configuration
PROJECT_NAME="$(basename "$MAIN_REPO_ROOT")"

# Task-Master integration removed: the script no longer depends on Task-Master. Legacy hints from .taskmaster are accepted.
# Deprecated flags (--id, --skip) remain accepted but are ignored.
fetch_task_details() {
  echo ""  # no-op
}

fetch_next_task() {
  echo ""  # no-op
}

# Generate worktree name from task details
generate_worktree_name_from_task() {
  local task_json="$1"

  # Extract task ID and title using jq (or basic grep/sed as fallback)
  if command -v jq > /dev/null 2>&1; then
    local task_id
    local task_title
    task_id="$(echo "$task_json" | jq -r '.task.id // .task.ID // empty' 2>/dev/null)"
    task_title="$(echo "$task_json" | jq -r '.task.title // .task.Title // empty' 2>/dev/null)"

  # Normalize task ID (remove "TM-" prefix if present)
    task_id="${task_id#TM-}"
    task_id="${task_id#tm-}"
    task_id="${task_id#tm-}"

    if [[ -z "$task_title" ]] || [[ "$task_title" == "null" ]]; then
      echo "task-${task_id}"
      return 0
    fi

    # Convert title to kebab-case
    local kebab_title
    kebab_title="$(echo "$task_title" \
      | tr '[:upper:]' '[:lower:]' \
      | tr -cd '[:alnum:][:space:]' \
      | tr ' ' '-' \
      | tr -s '-' \
      | sed 's/^-//' \
      | sed 's/-$//')"

    # Limit title length to 70 chars, truncating at word boundary
    if [[ ${#kebab_title} -gt 70 ]]; then
      # Truncate to 75 chars first to give room for word boundary
      kebab_title="${kebab_title:0:75}"
      # Find the last hyphen and truncate there
      kebab_title="$(echo "$kebab_title" | sed 's/-[^-]*$//')"
    fi

    # Remove trailing hyphen if present
    kebab_title="$(echo "$kebab_title" | sed 's/-$//')"

    echo "task-${task_id}-${kebab_title}"
  else
    # Fallback: basic parsing without jq
    echo -e "${YELLOW}⚠️  jq not found, using basic name generation${NC}" >&2
    echo "worktree-$(date +%Y%m%d-%H%M%S)"
    return 0
  fi
}

# Worktree name generation function (fallback when no --id provided)
generate_worktree_name() {
  # Try to get current legacy task files (if present). Use .taskmaster as a hint only.
  if [[ -d "$MAIN_REPO_ROOT/.taskmaster/tasks" ]]; then
    # Find most recently modified task file (macOS-compatible using stat and find)
    local latest_task
    latest_task="$(find "$MAIN_REPO_ROOT/.taskmaster/tasks" -type f -name "*.md" -exec stat -f "%m %N" {} \; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"

      if [[ -n "$latest_task" ]]; then
      # Extract task ID and title
      local task_id
      local task_title_raw
      task_id="$(basename "$latest_task" .md)"
      task_title_raw="$(grep -m1 '^# ' "$latest_task" 2>/dev/null | sed 's/^# //')"

      # If no title, just use ID
        if [[ -z "$task_title_raw" ]]; then
          echo "task-${task_id}"
          return 0
        fi

      # Convert title to kebab-case
      local kebab_title
      kebab_title="$(echo "$task_title_raw" \
        | tr '[:upper:]' '[:lower:]' \
        | tr -cd '[:alnum:][:space:]' \
        | tr ' ' '-' \
        | tr -s '-' \
        | sed 's/^-//' \
        | sed 's/-$//')"

      # Limit title length to 70 chars, truncating at word boundary
      if [[ ${#kebab_title} -gt 70 ]]; then
        # Truncate to 75 chars first to give room for word boundary
        kebab_title="${kebab_title:0:75}"
        # Find the last hyphen and truncate there
        kebab_title="$(echo "$kebab_title" | sed 's/-[^-]*$//')"
      fi

      # Remove trailing hyphen if present
      kebab_title="$(echo "$kebab_title" | sed 's/-$//')"

        echo "task-${task_id}-${kebab_title}"
        return 0
      fi
  fi

  # Fallback: generate timestamp-based name
  echo "worktree-$(date +%Y%m%d-%H%M%S)"
}

# Auto-generate worktree name if not provided
if [[ -n "$TASK_ID" ]]; then
  # Fetch task details from Task-Master using --id
  task_json="$(fetch_task_details "$TASK_ID")"
  if [[ -z "$task_json" ]]; then
    exit 1
  fi

  # Generate worktree name from task details
  WORKTREE_NAME="$(generate_worktree_name_from_task "$task_json")"
  echo -e "${GREEN}📋 Using legacy task source (Task-Master): ${TASK_ID}${NC}"
  echo -e "${GREEN}   Generated worktree name: ${WORKTREE_NAME}${NC}"
elif [[ -n "$SKIP_COUNT" ]] || [[ -z "$WORKTREE_NAME" ]]; then
  # Fetch next task from Task-Master (with optional skip)
  task_json="$(fetch_next_task "${SKIP_COUNT:-0}")"
  if [[ -z "$task_json" ]]; then
    exit 1
  fi

  # Extract task ID for display
  TASK_ID="$(echo "$task_json" | jq -r '.task.id // .task.ID // empty' 2>/dev/null)"

  # Generate worktree name from task details
  WORKTREE_NAME="$(generate_worktree_name_from_task "$task_json")"
  echo -e "${GREEN}📋 Using next legacy task: ${TASK_ID}${NC}"
  if [[ -n "$SKIP_COUNT" ]] && [[ "$SKIP_COUNT" -gt 0 ]]; then
    echo -e "${GREEN}   (skipped ${SKIP_COUNT} tasks)${NC}"
  fi
  echo -e "${GREEN}   Generated worktree name: ${WORKTREE_NAME}${NC}"
fi

# Sanitize worktree name (replace / with - for directory name)
WORKTREE_DIR_NAME="${WORKTREE_NAME//\//-}"
WORKTREE_PATH="$HOME/Projects/$PROJECT_NAME/wt/$WORKTREE_DIR_NAME"

# Check if worktree already exists
if [[ -e "$WORKTREE_PATH" ]]; then
  echo -e "${RED}Error: Worktree already exists at $WORKTREE_PATH${NC}" >&2
  exit 1
fi

# Check if base branch exists
if ! git show-ref --verify --quiet "refs/heads/$BASE_BRANCH" && ! git show-ref --verify --quiet "refs/remotes/origin/$BASE_BRANCH"; then
  echo -e "${RED}Error: Branch '$BASE_BRANCH' not found${NC}" >&2
  exit 1
fi

echo -e "${GREEN}🌳 Creating worktree: ${WORKTREE_NAME}${NC}"
echo "   Base branch: $BASE_BRANCH"
echo "   New branch: $WORKTREE_NAME"
echo "   Location: $WORKTREE_PATH"
echo ""

# Ensure project directory exists
mkdir -p "$(dirname "$WORKTREE_PATH")"

# Create the worktree with a new branch
if ! git worktree add "$WORKTREE_PATH" -b "$WORKTREE_NAME" "$BASE_BRANCH" 2>/dev/null; then
  echo -e "${RED}Error: Failed to create worktree${NC}" >&2
  exit 1
fi

echo -e "${GREEN}✅ Worktree created${NC}"

# Symlink creation function
create_symlink() {
  local source="$1"  # Main repo directory (absolute path)
  local target="$2"  # Worktree directory (absolute path)
  local name="$3"    # Display name

  if [[ ! -d "$source" ]]; then
    echo -e "${YELLOW}⚠️  Skipping $name (source not found)${NC}"
    return 0
  fi

  if [[ -e "$target" ]]; then
    echo -e "${YELLOW}⚠️  Skipping $name (already exists)${NC}"
    return 0
  fi

  ln -s "$source" "$target"
  echo -e "${GREEN}✅ Symlinked $name → $source${NC}"
}

# Create symlinks to main repo's shared directories
create_symlink "$MAIN_REPO_ROOT/.claude" "$WORKTREE_PATH/.claude" ".claude/"
  # Legacy: do not symlink .taskmaster into worktrees by default. Leave as a hint only.

# Symlink .envrc if it exists (direnv configuration, not secrets)
create_symlink "$MAIN_REPO_ROOT/.envrc" "$WORKTREE_PATH/.envrc" ".envrc/"

# Auto-allow direnv for the new worktree if available
if [[ -f "$WORKTREE_PATH/.envrc" ]]; then
  if command -v direnv > /dev/null 2>&1; then
    if (cd "$WORKTREE_PATH" && direnv allow > /dev/null 2>&1); then
      echo -e "${GREEN}✅ Allowed direnv in worktree (direnv allow)${NC}"
    else
      echo -e "${YELLOW}⚠️  Failed to run 'direnv allow'${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  .envrc found but 'direnv' is not installed${NC}"
  fi
fi

# Notes about thoughts/ directory
if [[ -d "$MAIN_REPO_ROOT/thoughts" ]]; then
  if [[ "${CREATE_THOUGHTS_SYMLINK:-false}" == "true" ]]; then
    create_symlink "$MAIN_REPO_ROOT/thoughts" "$WORKTREE_PATH/thoughts" "thoughts/"
  else
    echo -e "${YELLOW}⚠️  thoughts/ exists in main repo but not symlinked${NC}"
    echo "   • If thoughts/ is git-tracked, symlinking causes merge conflicts"
    echo "   • If thoughts/ is gitignored, set CREATE_THOUGHTS_SYMLINK=true to share"
    echo "   • Or copy manually: cp -r $MAIN_REPO_ROOT/thoughts ."
  fi
fi

# Run initialization commands in the worktree
if [[ -f "$WORKTREE_PATH/Makefile" ]]; then
  echo ""
  echo "Running initialization..."

  # Prefer full project setup; fall back to hook installation
  if grep -q "^setup:" "$WORKTREE_PATH/Makefile" 2>/dev/null; then
    if (cd "$WORKTREE_PATH" && make setup >/dev/null 2>&1); then
      echo -e "${GREEN}✅ Ran project setup (make setup)${NC}"
    else
      echo -e "${YELLOW}⚠️  Failed to run 'make setup'${NC}"
      if grep -q "^hooks:" "$WORKTREE_PATH/Makefile" 2>/dev/null; then
        if (cd "$WORKTREE_PATH" && make hooks >/dev/null 2>&1); then
          echo -e "${GREEN}✅ Installed git hooks (fallback make hooks)${NC}"
        else
          echo -e "${YELLOW}⚠️  Failed to run fallback 'make hooks'${NC}"
        fi
      fi
    fi
  elif grep -q "^hooks:" "$WORKTREE_PATH/Makefile" 2>/dev/null; then
    if (cd "$WORKTREE_PATH" && make hooks >/dev/null 2>&1); then
      echo -e "${GREEN}✅ Installed git hooks (make hooks)${NC}"
    else
      echo -e "${YELLOW}⚠️  Failed to run 'make hooks'${NC}"
    fi
  fi
fi

# Check for .env.example files
if [[ -f "$WORKTREE_PATH/.env.example" ]] && [[ ! -f "$WORKTREE_PATH/.env.local" ]]; then
  echo ""
  echo -e "${YELLOW}⚠️  Found .env.example, consider creating .env.local${NC}"
  echo "   cp .env.example .env.local"
fi

# Check for environment files that exist in main repo but not in worktree
# Note: We don't auto-copy these as they may contain secrets
ENV_FILES=(".env" ".env.local" ".env.development" ".env.production" ".env.test")
for env_file in "${ENV_FILES[@]}"; do
  if [[ -f "$MAIN_REPO_ROOT/$env_file" ]] && [[ ! -f "$WORKTREE_PATH/$env_file" ]]; then
    echo ""
    echo -e "${YELLOW}⚠️  Found $env_file in main repo (not copied - may contain secrets)${NC}"
    echo "   Copy manually if needed: cp $MAIN_REPO_ROOT/$env_file $env_file"
    break  # Only show the message once
  fi
done

echo ""
echo "Next steps:"
echo "  cd $WORKTREE_PATH"
echo ""
echo -e "${GREEN}✨ Worktree ready!${NC}"
