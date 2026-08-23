# Multi-Provider Claude Session Management
#
# This script enables isolated Claude sessions for different API providers:
# - Each provider gets its own config directory under ~/.claude-sessions/$provider/
# - Skills, agents, and commands are symlinked from ~/.claude/ (shared)
# - Provider-specific environment (API keys, base URLs, models) is injected via settings.json
#
# Usage:
#   glm        - Launch Claude with Z.ai (GLM) provider
#   mm         - Launch Claude with MiniMax provider
#
# To add a new provider:
#   1. Add entry to _CLAUDE_PROVIDER_ENVS with provider JSON config
#   2. Add API key variable name to _CLAUDE_PROVIDER_KEY_VARS
#   3. Create a wrapper function at the bottom (e.g., newprovider() { _launch_provider "newprovider" "$@" })

# Load your local keys
[[ -f "$HOME/.env" ]] && source "$HOME/.env"

# --- Provider registry ---
# Central registry of all configured providers.
# To add a new provider:
# 1. Add provider env JSON to _CLAUDE_PROVIDER_ENVS
# 2. Add API key variable name to _CLAUDE_PROVIDER_KEY_VARS
typeset -gA _CLAUDE_PROVIDER_ENVS
typeset -gA _CLAUDE_PROVIDER_KEY_VARS

# GLM (Zai AI) configuration
_CLAUDE_PROVIDER_ENVS[glm]='{
  "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.7",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.1",
  "API_TIMEOUT_MS": "3000000",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1
}'
_CLAUDE_PROVIDER_KEY_VARS[glm]="ZAI_API_KEY"

# MiniMax configuration
_CLAUDE_PROVIDER_ENVS[mm]='{
  "ANTHROPIC_BASE_URL": "https://api.minimax.io/anthropic",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "minimax-m3",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "minimax-m3",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "minimax-m3"
}'
_CLAUDE_PROVIDER_KEY_VARS[mm]="MINIMAX_API_KEY"

# Qwen3.7-Plus (Alibaba Cloud - Frankfurt) configuration
# Uses the EU workspace endpoint with workspace ID in the URL.
_CLAUDE_PROVIDER_ENVS[qwen]='{
  "ANTHROPIC_BASE_URL": "https://ws-bdwh8ou5c3ld4tpi.eu-central-1.maas.aliyuncs.com/apps/anthropic",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3.7-plus",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3.7-plus",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen3.7-plus",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1
}'
_CLAUDE_PROVIDER_KEY_VARS[qwen]="ALIBABA_API_KEY"

# DeepSeek V4 (Direct API) configuration
# V4 Flash is the default (Haiku + Sonnet); V4 Pro is the Opus equivalent.
_CLAUDE_PROVIDER_ENVS[ds]='{
  "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-flash",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1
}'
_CLAUDE_PROVIDER_KEY_VARS[ds]="DEEPSEEK_API_KEY"

# DeepSeek via OpenRouter (legacy) configuration
# Kept for fallback; same models served through OpenRouter.
_CLAUDE_PROVIDER_ENVS[openrouter]='{
  "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek/deepseek-v4-flash",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek/deepseek-v4-flash",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek/deepseek-v4-pro",
  "ANTHROPIC_AUTH_TOKEN": "${OPENROUTER_API_KEY}",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1
}'
_CLAUDE_PROVIDER_KEY_VARS[openrouter]="OPENROUTER_API_KEY"

# Get provider environment JSON from registry
_provider_env_json() {
    local provider="$1"

    if [[ -z "${_CLAUDE_PROVIDER_ENVS[$provider]}" ]]; then
        echo "Unsupported provider: $provider"
        return 1
    fi

    print -r -- "${_CLAUDE_PROVIDER_ENVS[$provider]}"
}

# Get provider API key variable name from registry
_provider_api_key_var() {
    local provider="$1"

    if [[ -z "${_CLAUDE_PROVIDER_KEY_VARS[$provider]}" ]]; then
        echo "Unsupported provider: $provider"
        return 1
    fi

    print -r -- "${_CLAUDE_PROVIDER_KEY_VARS[$provider]}"
}

# Get provider API key value (resolves the variable name)
_provider_api_key() {
    local provider="$1"
    local key_var

    key_var="$(_provider_api_key_var "$provider")" || return 1

    # Indirect variable reference to get the actual API key value
    print -r -- "${(P)key_var:-}"
}

_link_shared_claude_dirs() {
    local provider_config_dir="$1"
    local base_dir="$HOME/.claude"
    local shared_dir
    local target_path

    for shared_dir in skills agents commands; do
        if [[ -d "$base_dir/$shared_dir" ]]; then
            target_path="$provider_config_dir/$shared_dir"
            # Handle existing target: remove symlink/file, error on directory
            if [[ -L "$target_path" || -f "$target_path" ]]; then
                rm -- "$target_path"
            elif [[ -d "$target_path" ]]; then
                echo "Warning: $target_path is a directory, skipping symlink" >&2
                continue
            fi
            ln -s "$base_dir/$shared_dir" "$target_path" || return 1
        fi
    done
}

_launch_claude_parallel() {
    emulate -L zsh

    local provider="$1"
    local api_key="$2"
    shift 2

    local provider_config_dir="$HOME/.claude-sessions/$provider"
    mkdir -p "$provider_config_dir"
    _link_shared_claude_dirs "$provider_config_dir"

    if ! command -v jq >/dev/null 2>&1; then
        echo "jq is required for ${provider} provider config merging."
        echo "Install with: brew install jq  # macOS"
        echo "           : apt install jq    # Debian/Ubuntu"
        return 1
    fi

    local provider_env_json
    provider_env_json="$(_provider_env_json "$provider")" || return 1

    # Bypass onboarding prompt for isolated provider session.
    if [[ ! -f "$provider_config_dir/.claude.json" ]]; then
        print -r -- '{"hasCompletedOnboarding": true}' >| "$provider_config_dir/.claude.json"
    fi

    local main_settings="$HOME/.claude/settings.json"
    local default_json='{}'
    [[ -f "$main_settings" ]] && default_json="$(<"$main_settings")"

    # Add the provider key into the provider env block.
    local overrides
    overrides="$(jq --arg key "$api_key" '. + {ANTHROPIC_AUTH_TOKEN: $key}' <<<"$provider_env_json")" || return 1

    # Merge global settings with provider env block.
    jq --argjson env "$overrides" '. * {env: $env}' <<<"$default_json" >| "$provider_config_dir/settings.json" || return 1

    echo "Starting isolated Claude session for ${provider}..."
    CLAUDE_CONFIG_DIR="$provider_config_dir" claude "$@"
}

_launch_provider() {
    local provider="$1"
    shift

    local api_key
    local key_var

    # Get the API key variable name for this provider
    key_var="$(_provider_api_key_var "$provider")" || return 1

    # Check if the API key is set before launching
    if [[ -z "${(P)key_var:-}" ]]; then
        echo "Missing API key for provider '${provider}': ${key_var} not set"
        return 1
    fi

    api_key="$(_provider_api_key "$provider")" || return 1

    _launch_claude_parallel "$provider" "$api_key" "$@"
}

claude-glm() {
    _launch_provider "glm" "$@"
}

claude-mm() {
    _launch_provider "mm" "$@"
}

claude-ds() {
    _launch_provider "ds" "$@"
}

claude-qwen() {
    _launch_provider "qwen" "$@"
}

claude-openrouter() {
    _launch_provider "openrouter" "$@"
}

# List available providers and their API key status
claude-providers() {
    echo "Available Claude providers:"
    echo ""
    for p in "${(k)_CLAUDE_PROVIDER_ENVS[@]}"; do
        key_var="${_CLAUDE_PROVIDER_KEY_VARS[$p]}"
        if [[ -n "${(P)key_var:-}" ]]; then
            status="✓ set"
        else
            status="✗ not set"
        fi
        printf "  %-6s %s (%s)\n" "$p" "$status" "$key_var"
    done
}

# Shared helper: source ~/.env, then the nearest project .env (walking up from
# $PWD), and export all known AI provider API keys.
# Used by the droid wrapper. Pi/OMP inherit the same behavior from the
# local-env extension (dot_pi/agent/extensions/local-env.ts), so they no
# longer need shell-side env loading.
# Local .env values override ~/.env — use this for per-project keys like
# OPENCODE_API_KEY.
_load_ai_env() {
    [[ -f "$HOME/.env" ]] && source "$HOME/.env"
    local dir="$PWD" found=""
    while [[ "$dir" != "/" && "$dir" != "." ]]; do
        if [[ -f "$dir/.env" ]]; then
            found="$dir/.env"
            break
        fi
        dir="${dir:h}"
    done
    [[ -n "$found" ]] && source "$found"
    export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
    export MINIMAX_API_KEY="${MINIMAX_API_KEY:-}"
    export ZAI_API_KEY="${ZAI_API_KEY:-}"
    export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
    export ALIBABA_API_KEY="${ALIBABA_API_KEY:-}"
    export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"
    export OPENCODE_API_KEY="${OPENCODE_API_KEY:-}"
}


# Factory Droid wrapper — ensures ~/.env API keys are available and exported
droid() {
    _load_ai_env

    local api_keys_missing=""
    [[ -z "${ZAI_API_KEY:-}" ]] && api_keys_missing="${api_keys_missing}ZAI_API_KEY "
    [[ -z "${MINIMAX_API_KEY:-}" ]] && api_keys_missing="${api_keys_missing}MINIMAX_API_KEY "
    [[ -z "${OPENROUTER_API_KEY:-}" ]] && api_keys_missing="${api_keys_missing}OPENROUTER_API_KEY "
    [[ -z "${ALIBABA_API_KEY:-}" ]] && api_keys_missing="${api_keys_missing}ALIBABA_API_KEY "
    [[ -z "${DEEPSEEK_API_KEY:-}" ]] && api_keys_missing="${api_keys_missing}DEEPSEEK_API_KEY "

    if [[ -n "$api_keys_missing" ]]; then
        echo "Warning: Missing API keys: $api_keys_missing" >&2
        echo "Set them in ~/.env or export before running droid" >&2
    fi

    command droid "$@"
}

# Pi coding-agent wrapper — local-env loads API keys and PI_DEFAULT_MODEL.
# mise-env resolves directory-specific variables for Bash tool processes.
# No shell setup is needed here.
pi() {
    command pi "$@"
}

# OMP resolves its own project environment. PI_DEFAULT_MODEL avoids conflict
# with Pi's PI_MODEL session metadata.
omp() {
    command omp "$@"
}
