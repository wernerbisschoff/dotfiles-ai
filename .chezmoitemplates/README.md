# Chezmoi Templates — Prompt Unification

This directory holds **core prompt templates** shared by the Pi and Codex
configurations.

## Directory Structure

```
.chezmoitemplates/
├── AGENTS.md.tmpl    # Shared agent guidance (Pi, Codex, OpenCode)
├── skills/           # Shared skill definitions (render to ~/.agents/skills)
├── prompts/          # Shared slash-command prompts
│   ├── prompts/      # Core prompts for prompt-refine / prompt-evaluate
│   └── tools/        # Core prompts for tool commands
├── rules/            # Shared rule snippets
└── scripts/          # Shared helper scripts
```

## Editing Rules (Critical)

### 📝 Core Templates (Authoritative)

- **Edit these files** when updating shared content.
- These are the **single source of truth** for skills, prompts, and agent guidance.
- Changes here propagate on the next apply.

### 🔗 Generated Files (Do NOT Edit)

- `dot_agents/skills/*` — rendered from `.chezmoitemplates/skills/*.tmpl`.
- `dot_pi/agent/AGENTS.md`, `dot_codex/AGENTS.md`,
  `dot_config/opencode/AGENTS.md` — rendered from `AGENTS.md.tmpl`.
- **Never edit directly** — changes are lost on the next apply.

## Template Variables

### Destination-Based Conditionals

Templates can render tool-specific content via `.chezmoi.targetFile`:

```chezmoitmpl
{{ if contains "/.codex/" .chezmoi.targetFile }}
Codex-specific content here...
{{ end }}

{{ if contains "/.config/opencode/" .chezmoi.targetFile }}
Opencode-specific content here...
{{ end }}
```

### Common Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `.chezmoi.targetFile` | Destination directory path | `/Users/werner/.codex/AGENTS.md` |
| `.chezmoi.sourceDir` | Source directory (chezmoi root) | `/Users/werner/.local/share/chezmoi-ai` |
| `.chezmoi.homeDir` | User's home directory | `/Users/werner` |

### User-Provided Arguments

Pass user arguments through as `$ARGUMENTS`.

| File Type | Location | Owner | Editable? | Maintenance |
|-----------|----------|-------|-----------|-------------|
| Core skills | `.chezmoitemplates/skills/**/*` | You | ✅ Yes | Edit as needed |
| Shared agent skills | `dot_agents/skills/**/*` | Generated | ❌ No | Auto-regenerated |
| Agent guidance | `dot_pi/`, `dot_codex/`, `dot_config/opencode/` | Generated | ❌ No | Auto-regenerated |

## Maintenance Instructions

1. **Update a skill or prompt**: edit the core `.tmpl` file in `.chezmoitemplates/`.
2. **Apply changes**: run `mise run apply` (pinned to ~/.local/share/chezmoi-ai).
3. **Verify**: check rendered files in `~/.agents/`, `~/.pi/`, `~/.codex/`.
4. **Rollback**: revert the core template and re-apply.

## Workflow

1. **Edit core template**: modify the `.tmpl` file in `.chezmoitemplates/`.
2. **Test locally**: run `chezmoi -S ~/.local/share/chezmoi-ai diff` to preview.
3. **Apply**: run `mise run apply`.
4. **Verify**: check rendered files in `dot_agents/`, `dot_pi/`, `dot_codex/`.

## Debugging Template Issues

If rendered files lack expected content:

1. Check template syntax with `chezmoi execute-template < file`.
2. Verify variable names match `.chezmoi` documentation.
3. Ensure `{{ template "<path>" . }}` paths are relative to `.chezmoitemplates/`.
4. Run `chezmoi -S ~/.local/share/chezmoi-ai apply --dry-run` to preview.

---

**Remember**: when in doubt, edit the core template in `.chezmoitemplates/` and let chezmoi handle the rest.
