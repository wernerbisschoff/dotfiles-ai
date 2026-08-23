# CLAUDE.md

Guidance for AI agents working in this chezmoi dotfiles repo (AI-agent scope).

## Critical: Source vs Destination

You are in the **SOURCE directory**: `~/.local/share/chezmoi-ai`.
This is **NOT** `~`, `$HOME`, `~/.claude/`, `~/.pi/`, `~/.config/`, or any rendered destination.
Chezmoi auto-generates those targets and overwrites them on apply.

**GOLDEN RULE**: All edits go in this directory.
Never edit rendered destinations — those changes are lost.

**Before any edit**: verify the file's path starts with `~/.local/share/chezmoi-ai/`.
If not, STOP — find the source file here instead.

The OS/shell repo (`wernerbisschoff/dotfiles`, source `~/.local/share/chezmoi`)
owns zsh, starship, gitconfig, SSH, and toolchain targets. Do not move those
targets here.

### Common source → destination

| Edit this... | Source (in this repo) |
|---|---|
| `~/.claude/commands/*.md` | `.chezmoitemplates/prompts/tools/*.tmpl` |
| `~/.claude/skills/*/SKILL.md` | `.chezmoitemplates/skills/*.tmpl` |
| `~/.pi/agent/settings.json` | `dot_pi/agent/settings.json.tmpl` |
| `~/.config/opencode/opencode.json` | `dot_config/opencode/opencode.json` |

## Slash Commands vs Skills (`tools-*` rule)

`tools-*` = slash commands by default, **never skills**.
Commands load on `/<name>`; skills load eagerly and burn context.
Exception only if it must run `~/.claude/scripts/<name>.sh pre|post` — even then prefer the command form.

## Editing Workflow

1. Edit source files in this directory
2. Apply only the changed files, never a full `chezmoi apply --force`:

   ```bash
   chezmoi -S ~/.local/share/chezmoi-ai apply <target-file>...   # pinned to THIS source dir
   chezmoi -S ~/.local/share/chezmoi-ai apply dot_claude/settings.json   # source path
   mise run apply                                                # same, from this repo dir
   ```

   **Never run a bare `chezmoi apply` here** — without `-S` it targets
   `~/.local/share/chezmoi` (the OS repo). Always pin `-S ~/.local/share/chezmoi-ai`
   or use `mise run apply`.

3. `chezmoi -S ~/.local/share/chezmoi-ai diff` / `status` to verify.

**When you must re-render generated files (e.g. `.chezmoitemplates/**`), apply
only those targets** (`chezmoi -S ~/.local/share/chezmoi-ai apply dot_claude/`),
not the whole tree.

**Worktrees**: if `$PWD` contains `.worktrees/`, pass `-S "$PWD"` to all chezmoi commands.

## Template Syntax (CRITICAL)

**Never use `.args.X` / `.Args.X`** in agent prompt templates — they fail with
`map has no entry for key "args"`. Always use:

```chezmoitmpl
{{ if or (contains ".factory/" (.chezmoi.targetFile | toString)) (contains ".gemini/" (.chezmoi.targetFile | toString)) }}{{"{{args}}"}}{{ else }}$ARGUMENTS{{ end }}
```

Applies to ALL user-provided arguments.

**Destination conditionals**: `{{ if contains "/.claude/" .chezmoi.targetFile }}Claude content{{ end }}`.

**Inclusion**: `{{ template "skills/commit.tmpl" . }}`.

### File Naming Directives (prefixes)

`executable_` (+x) — add execute permission
`symlink_` (symlink) — replace the file with a symlink
`dot_` (dot) — prefix the destination name with `.`
`private_` (0o600) — set file mode to 0o600
`exact_` (exact) — remove unmanaged files from the destination directory
`encrypted_` (encrypted) — decrypt the file first

Reference rendered files by name **without** the prefix.

## Generated Files (DO NOT Edit)

Auto-overwritten by `chezmoi apply`:

- `dot_claude/commands/**/*.md.tmpl` ← `.chezmoitemplates/prompts/tools/*.tmpl`
- `dot_claude/skills/*/SKILL.md.tmpl` ← `.chezmoitemplates/skills/*.tmpl`
- `dot_codex/`, `dot_gemini/` ← `.chezmoitemplates/prompts/`

To modify: edit `.chezmoitemplates/prompts/**/*.tmpl`, then apply only the
generated targets (`chezmoi -S ~/.local/share/chezmoi-ai apply dot_claude/`).

## Opencode Symlink Bridge

`~/.config/opencode/{skills,command}` are symlinks to `~/.claude/{skills,commands}`.
Edit Claude templates + apply only `dot_claude/` targets updates both.
Never edit opencode paths directly.

## Cross-Platform

Use `perl -i -pe` (not `sed -i`) for in-place edits — different syntax on macOS vs Linux.

## Common Commands

```bash
mise run apply|diff|status|verify          # pinned to ~/.local/share/chezmoi-ai
chezmoi -S ~/.local/share/chezmoi-ai edit <file>   # open source in $EDITOR
chezmoi -S ~/.local/share/chezmoi-ai add ~/.path/file  # track new file from home
```

## Documentation Lookup

Prefer `libref query <lib> "<topic>"` over web fetching. Workflow:
`libref list` → `libref query` → `libref add <git-url>` (register a missing
source) → web fetch (last resort). For chezmoi itself:
`libref query chezmoi@2.61.0 '<topic>'`.