#!/usr/bin/env bash
# Collect comprehensive project metadata for documentation and research
# Technology-agnostic version adapted from humanlayer

set -euo pipefail

# Collect basic metadata
DATETIME_TZ=$(date '+%Y-%m-%d %H:%M:%S %Z')
FILENAME_TS=$(date '+%Y-%m-%d_%H-%M-%S')

# Git information (if available)
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_ROOT=$(git rev-parse --show-toplevel)
    REPO_NAME=$(basename "$REPO_ROOT")
    GIT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD)
    GIT_COMMIT=$(git rev-parse HEAD)
    GIT_COMMIT_SHORT=$(git rev-parse --short HEAD)
    GIT_STATUS=$(git status --porcelain | wc -l | tr -d ' ')
else
    REPO_ROOT=""
    REPO_NAME=""
    GIT_BRANCH=""
    GIT_COMMIT=""
    GIT_COMMIT_SHORT=""
    GIT_STATUS=""
fi

# Project information
if [ -n "$REPO_ROOT" ]; then
    PROJECT_NAME="$REPO_NAME"
else
    PROJECT_NAME=$(basename "$(pwd)")
fi

# Technology detection
TECH_STACK=""
if [ -f "package.json" ]; then
    TECH_STACK="$TECH_STACK node"
    NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
    PACKAGE_MANAGER="npm"
    
    # Detect actual package manager
    if [ -f "bun.lockb" ] && command -v bun >/dev/null; then
        PACKAGE_MANAGER="bun"
        BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
    elif [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null; then
        PACKAGE_MANAGER="pnpm"
        PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "unknown")
    elif [ -f "yarn.lock" ] && command -v yarn >/dev/null; then
        PACKAGE_MANAGER="yarn"
        YARN_VERSION=$(yarn --version 2>/dev/null || echo "unknown")
    else
        NPM_VERSION=$(npm --version 2>/dev/null || echo "unknown")
    fi
fi

if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
    TECH_STACK="$TECH_STACK python"
    PYTHON_VERSION=$(python --version 2>/dev/null | cut -d' ' -f2 || python3 --version 2>/dev/null | cut -d' ' -f2 || echo "unknown")
fi

if [ -f "Cargo.toml" ]; then
    TECH_STACK="$TECH_STACK rust"
    RUST_VERSION=$(rustc --version 2>/dev/null | cut -d' ' -f2 || echo "unknown")
fi

if [ -f "go.mod" ]; then
    TECH_STACK="$TECH_STACK go"
    GO_VERSION=$(go version 2>/dev/null | cut -d' ' -f3 | sed 's/go//' || echo "unknown")
fi

if [ -f "pom.xml" ] || [ -f "build.gradle" ]; then
    TECH_STACK="$TECH_STACK java"
    JAVA_VERSION=$(java -version 2>&1 | head -n1 | cut -d'"' -f2 || echo "unknown")
fi

if [ -f "composer.json" ]; then
    TECH_STACK="$TECH_STACK php"
    PHP_VERSION=$(php --version 2>/dev/null | head -n1 | cut -d' ' -f2 || echo "unknown")
fi

if [ -f "Gemfile" ]; then
    TECH_STACK="$TECH_STACK ruby"
    RUBY_VERSION=$(ruby --version 2>/dev/null | cut -d' ' -f2 || echo "unknown")
fi

# Clean up tech stack
TECH_STACK=$(echo "$TECH_STACK" | sed 's/^ *//' | sed 's/ *$//')

# Framework detection (for Node.js projects)
FRAMEWORKS=""
if [ -f "package.json" ]; then
    if grep -q '"next"' package.json 2>/dev/null; then
        FRAMEWORKS="$FRAMEWORKS nextjs"
    fi
    if grep -q '"expo"' package.json 2>/dev/null; then
        FRAMEWORKS="$FRAMEWORKS expo"
    fi
    if grep -q '"react"' package.json 2>/dev/null; then
        FRAMEWORKS="$FRAMEWORKS react"
    fi
    if grep -q '"vue"' package.json 2>/dev/null; then
        FRAMEWORKS="$FRAMEWORKS vue"
    fi
    if grep -q '"svelte"' package.json 2>/dev/null; then
        FRAMEWORKS="$FRAMEWORKS svelte"
    fi
fi

FRAMEWORKS=$(echo "$FRAMEWORKS" | sed 's/^ *//' | sed 's/ *$//')

# System information
OS_INFO=$(uname -s 2>/dev/null || echo "unknown")
ARCH_INFO=$(uname -m 2>/dev/null || echo "unknown")

# Output format
echo "# Project Metadata"
echo ""
echo "**Generated**: $DATETIME_TZ"
echo "**Filename Timestamp**: $FILENAME_TS"
echo ""

echo "## Project Information"
echo "- **Name**: $PROJECT_NAME"
echo "- **Technology Stack**: ${TECH_STACK:-unknown}"
echo "- **Frameworks**: ${FRAMEWORKS:-none}"

if [ -n "$GIT_COMMIT" ]; then
    echo ""
    echo "## Git Information" 
    echo "- **Repository**: $REPO_NAME"
    echo "- **Branch**: $GIT_BRANCH"
    echo "- **Commit**: $GIT_COMMIT_SHORT ($GIT_COMMIT)"
    echo "- **Uncommitted Changes**: $GIT_STATUS files"
fi

echo ""
echo "## Environment"
echo "- **OS**: $OS_INFO ($ARCH_INFO)"

# Technology versions
if [[ "$TECH_STACK" == *"node"* ]]; then
    echo "- **Node.js**: ${NODE_VERSION:-unknown}"
    echo "- **Package Manager**: $PACKAGE_MANAGER"
    case "$PACKAGE_MANAGER" in
        "bun") echo "- **Bun Version**: ${BUN_VERSION:-unknown}" ;;
        "pnpm") echo "- **PNPM Version**: ${PNPM_VERSION:-unknown}" ;;
        "yarn") echo "- **Yarn Version**: ${YARN_VERSION:-unknown}" ;;
        "npm") echo "- **NPM Version**: ${NPM_VERSION:-unknown}" ;;
    esac
fi

if [[ "$TECH_STACK" == *"python"* ]]; then
    echo "- **Python**: ${PYTHON_VERSION:-unknown}"
fi

if [[ "$TECH_STACK" == *"rust"* ]]; then
    echo "- **Rust**: ${RUST_VERSION:-unknown}"
fi

if [[ "$TECH_STACK" == *"go"* ]]; then
    echo "- **Go**: ${GO_VERSION:-unknown}"
fi

if [[ "$TECH_STACK" == *"java"* ]]; then
    echo "- **Java**: ${JAVA_VERSION:-unknown}"
fi

if [[ "$TECH_STACK" == *"php"* ]]; then
    echo "- **PHP**: ${PHP_VERSION:-unknown}"
fi

if [[ "$TECH_STACK" == *"ruby"* ]]; then
    echo "- **Ruby**: ${RUBY_VERSION:-unknown}"
fi

# Additional project structure info
echo ""
echo "## Project Structure"
if [ -f "Makefile" ] || [ -f "makefile" ]; then
    echo "- **Build System**: Make"
fi

if [ -f "package.json" ]; then
    SCRIPT_COUNT=$(jq -r '.scripts | length' package.json 2>/dev/null || echo "0")
    echo "- **NPM Scripts**: $SCRIPT_COUNT defined"
fi

if [ -d ".git" ]; then
    WORKTREE_COUNT=$(git worktree list | wc -l | tr -d ' ')
    echo "- **Git Worktrees**: $((WORKTREE_COUNT - 1)) additional"
fi

# For shell variable exports
if [ "${1:-}" = "--shell" ]; then
    echo ""
    echo "# Shell Variables (source this section)"
    echo "export PROJECT_NAME='$PROJECT_NAME'"
    echo "export GIT_BRANCH='$GIT_BRANCH'"
    echo "export GIT_COMMIT='$GIT_COMMIT'"
    echo "export FILENAME_TS='$FILENAME_TS'"
    echo "export TECH_STACK='$TECH_STACK'"
    echo "export FRAMEWORKS='$FRAMEWORKS'"
fi