#!/usr/bin/env bash
# Helper functions for clean command execution with progress feedback
# Adapted from humanlayer for universal project support

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print a header for a task section
print_header() {
    local project="$1"
    local task="$2"
    echo -e "${BLUE}🔧 ${project}: ${task}${NC}"
}

# Print a main header for the overall operation
print_main_header() {
    local operation="$1"
    echo -e "${BLUE}"
    echo "============================================"
    echo "  $operation"
    echo "============================================"
    echo -e "${NC}"
}

# Run a command silently and report success/failure
run_silent() {
    local message="$1"
    local command="$2"
    
    if eval "$command" >/dev/null 2>&1; then
        echo -e "✅ ${GREEN}$message${NC}"
        return 0
    else
        echo -e "❌ ${RED}$message failed${NC}"
        echo -e "${YELLOW}Running command with output:${NC}"
        eval "$command"  # Show the error output
        return 1
    fi
}

# Run a command with suppressed output but show errors
run_with_quiet() {
    local message="$1"
    local command="$2"
    
    local temp_output
    temp_output=$(mktemp)
    
    if eval "$command" > "$temp_output" 2>&1; then
        echo -e "✅ ${GREEN}$message${NC}"
        rm "$temp_output"
        return 0
    else
        echo -e "❌ ${RED}$message failed${NC}"
        echo -e "${YELLOW}Error output:${NC}"
        cat "$temp_output"
        rm "$temp_output"
        return 1
    fi
}

# Run tests and count results
run_silent_with_test_count() {
    local message="$1"
    local command="$2"
    local test_type="$3"
    
    local temp_output
    temp_output=$(mktemp)
    
    if eval "$command" > "$temp_output" 2>&1; then
        # Try to extract test count from common patterns
        local count=""
        case "$test_type" in
            "pytest")
                count=$(grep -o '[0-9]* passed' "$temp_output" | head -1 || echo "tests")
                ;;
            "jest"|"npm test")
                count=$(grep -o '[0-9]* passed' "$temp_output" | head -1 || echo "tests")
                ;;
            "go test")
                count=$(grep -o 'PASS.*[0-9]*\.[0-9]*s' "$temp_output" | wc -l | tr -d ' ')
                [ "$count" != "0" ] && count="$count tests" || count="tests"
                ;;
            "cargo test")
                count=$(grep -o '[0-9]* passed' "$temp_output" | head -1 || echo "tests")
                ;;
            *)
                count="tests"
                ;;
        esac
        
        echo -e "✅ ${GREEN}$message ($count)${NC}"
        rm "$temp_output"
        return 0
    else
        echo -e "❌ ${RED}$message failed${NC}"
        echo -e "${YELLOW}Test output:${NC}"
        cat "$temp_output"
        rm "$temp_output"
        return 1
    fi
}

# Progress indicator for long-running commands
run_with_progress() {
    local message="$1"
    local command="$2"
    local interval=${3:-1}
    
    echo -n -e "${YELLOW}⏳ $message... ${NC}"
    
    # Start the command in background
    eval "$command" >/dev/null 2>&1 &
    local pid=$!
    
    # Show progress spinner
    local spin='-\|/'
    local i=0
    while kill -0 $pid 2>/dev/null; do
        i=$(( (i+1) %4 ))
        printf "\r${YELLOW}⏳ $message... ${spin:$i:1} ${NC}"
        sleep $interval
    done
    
    # Check exit status
    wait $pid
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        printf "\r✅ ${GREEN}$message... ✓${NC}\n"
        return 0
    else
        printf "\r❌ ${RED}$message... ✗${NC}\n"
        echo -e "${YELLOW}Re-running with output:${NC}"
        eval "$command"
        return $exit_code
    fi
}

# Utility function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Utility function to detect project type
detect_project_type() {
    if [ -f "package.json" ]; then
        echo "node"
    elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
        echo "python"
    elif [ -f "Cargo.toml" ]; then
        echo "rust"
    elif [ -f "go.mod" ]; then
        echo "go"
    elif [ -f "pom.xml" ] || [ -f "build.gradle" ]; then
        echo "java"
    elif [ -f "composer.json" ]; then
        echo "php"
    elif [ -f "Gemfile" ]; then
        echo "ruby"
    elif [ -f "CMakeLists.txt" ] || ls *.cpp >/dev/null 2>&1; then
        echo "cpp"
    elif ls *.c >/dev/null 2>&1; then
        echo "c"
    else
        echo "unknown"
    fi
}

# Export functions for use in other scripts
export -f print_header
export -f print_main_header  
export -f run_silent
export -f run_with_quiet
export -f run_silent_with_test_count
export -f run_with_progress
export -f command_exists
export -f detect_project_type