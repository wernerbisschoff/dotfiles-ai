# Chezmoi Templates — Prompt Unification

This directory contains **core prompt templates** that are unified across Claude Code, Codex, and Gemini CLI configurations.

## Directory Structure

```
.chezmoitemplates/
├── prompts/
│   ├── plan/        # Core prompts for plan: commands
│   ├── tm/          # Core prompts for tm: commands
│   └── tools/       # Core prompts for tools: commands
└── README.md        # This file
```

## Editing Rules (Critical)

### 📝 Core Prompts (Authoritative)

**Location**: `.chezmoitemplates/prompts/{plan,tm,tools}/{name}.md`

- **Edit these files** when updating prompt content
- These are the **single source of truth** for prompt definitions
- Changes here automatically propagate to all tools (Claude, Codex, Gemini)

### 🔗 Generated Files (Do NOT Edit)

- **Claude**: `dot_claude/commands/{plan,tm,tools}/{name}.md`
- Generated via `{{ template "prompts/plan/{name}.md" . }}`
- **Never edit directly** — changes will be lost on the next apply

**Codex**: `dot_codex/skills/{name}/SKILL.md`
- Generated from `.chezmoitemplates/prompts/{name}.md.tmpl`
- **Never edit directly** — changes will be lost on the next apply

**Gemini**: `dot_gemini/commands/{name}.toml`
- Generated from `.chezmoitemplates/prompts/{name}.toml.tmpl`
- **Never edit directly** — changes will be lost on the next apply

## Template Variables

### Destination-Based Conditionals

Since templates render to different tool directories, use `.chezmoi.targetFile` for tool-specific customization:

```chezmoitmpl
{{ if contains "/.claude/" .chezmoi.targetFile }}
Claude-specific content here...
{{ end }}

{{ if contains "/.codex/" .chezmoi.targetFile }}
Codex-specific content here...
{{ end }}

{{ if contains "/.gemini/" .chezmoi.targetFile }}
Gemini-specific content here...
{{ end }}

{{ if contains "/.config/opencode/" .chezmoi.targetFile }}
Opencode-specific content here...
{{ end }}
```

#### Usage Example

```chezmoitmpl
# Core prompt content (shared across all tools)

You are implementing a command with the following requirements...

{{ if contains "/.claude/" .chezmoi.targetFile }}
## Claude-Specific Instructions

- Use the `/sdd:implement` workflow (preferred; `/plan:implement` is legacy)
- Follow debugging-first development principles
- Run `/sdd:sync` before committing (legacy: `/plan:sync`)
{{ end }}

{{ if contains "/.codex/" .chezmoi.targetFile }}
## Codex-Specific Instructions

- Use the `/sdd:implement` workflow (replaces `/tm:implement`)
- Track progress via SDD-based tasks and artifacts
- Run `/sdd:sync` before committing
{{ end }}

{{ if contains "/.gemini/" .chezmoi.targetFile }}
## Gemini-Specific Instructions

- Use the `--model=gemini-2.5-flash` flag
- Output format should match plan specifications
{{ end }}
```

### Common Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `.chezmoi.targetFile` | Destination directory path | `/Users/werner/.claude/commands` |
| `.chezmoi.sourceDir` | Source directory (chezmoi root) | `/Users/werner/.local/share/chezmoi-ai` |
| `.chezmoi.homeDir` | User's home directory | `/Users/werner` |

## File Ownership

| File Type | Location | Owner | Editable? | Maintenance |
|-----------|----------|-------|-----------|-------------|
| Core prompts | `.chezmoitemplates/prompts/**/*` | Werner | ✅ Yes | Edit as needed |
| Claude commands | `dot_claude/commands/**/*` | Generated | ❌ No | Auto-regenerated |
| Codex skills | `dot_codex/skills/**/*` | Generated | ❌ No | Auto-regenerated |
| Gemini configs | `dot_gemini/commands/**/*` | Generated | ❌ No | Auto-regenerated |
| Opencode skills | `dot_config/opencode/skills/**/*` | Generated | ❌ No | Auto-regenerated |

## Core Prompt Inventory

| Category | Commands | Owner | Last Updated |
|----------|----------|-------|--------------|
| Plan | client, commit, decide, design, docs, explore, fix, implement, oneshot, prd, sync, tasks | Werner | 2026-02-09 |
| TM | commit, fix, implement, init, oneshot, research, sync-and-commit, tasks | Werner | 2026-02-09 |
| Tools | commit, create-worktree, domain, explain, init, pr, pr-review, research, review | Werner | 2026-02-09 |

## Maintenance Instructions

1. **Updating a prompt**: Edit the core `.tmpl` file in `.chezmoitemplates/prompts/`
2. **Applying changes**: Run `mise run apply` (pinned to ~/.local/share/chezmoi-ai) to regenerate all derived files
3. **Verification**: Check generated files in `~/.claude/`, `~/.codex/`, `~/.gemini/`, `~/.config/opencode/`
4. **Rollback**: If changes break something, revert the core template and re-apply

## Workflow

1. **Edit core prompt**: Modify `.chezmoitemplates/prompts/{category}/{name}.md`
2. **Test locally**: Run `chezmoi -S ~/.local/share/chezmoi-ai diff` to preview changes
3. **Apply**: Run `mise run apply` to generate all files
4. **Verify**: Check generated files in `dot_claude/`, `dot_codex/`, `dot_gemini/`

## Debugging Template Issues

If generated files don't contain expected content:

1. Check template syntax with `chezmoi execute-template < file`
2. Verify variable names match `.chezmoi` documentation
3. Ensure `{{ template "prompts/<path>" . }}` paths are relative to `.chezmoitemplates/`
4. Run `chezmoi -S ~/.local/share/chezmoi-ai apply --dry-run` to preview all changes

---

**Remember**: When in doubt, edit the core prompt in `.chezmoitemplates/prompts/` and let chezmoi handle the rest.
