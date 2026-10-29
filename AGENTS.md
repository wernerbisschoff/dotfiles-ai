# AGENTS.md

Guidance for AI agents working in this chezmoi dotfiles repo (AI-agent scope).

## Critical: Source vs Destination

You are in the **SOURCE directory**: `~/.local/share/chezmoi-ai`.
This is **NOT** `~`, `$HOME`, `~/.pi/`, `~/.codex/`, `~/.config/`, or any rendered destination.
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
| `~/.agents/skills/*/SKILL.md` | `dot_agents/skills/*/SKILL.md.tmpl` |
| `~/.codex/AGENTS.md` | `dot_codex/AGENTS.md.tmpl` |
| `~/.pi/agent/settings.json` | `dot_pi/agent/settings.json.tmpl` |
| `~/.config/opencode/opencode.json` | `dot_config/opencode/opencode.json` |

## Slash Commands vs Skills (`tools-*` rule)

`tools-*` = slash commands by default, **never skills**.
Commands load on `/<name>`; skills load eagerly and burn context.
Exception only if it must run a scripted hook `pre`/`post` — even then prefer the command form.

## Editing Workflow

1. Edit source files in this directory
2. Apply only the changed files, never a full `chezmoi apply --force`:

   ```bash
   chezmoi -S ~/.local/share/chezmoi-ai apply <target-file>...   # pinned to THIS source dir
   chezmoi -S ~/.local/share/chezmoi-ai apply dot_pi/agent/settings.json   # source path
   mise run apply                                                # same, from this repo dir
   ```

   **Never run a bare `chezmoi apply` here** — without `-S` it targets
   `~/.local/share/chezmoi` (the OS repo). Always pin `-S ~/.local/share/chezmoi-ai`
   or use `mise run apply`.

3. `chezmoi -S ~/.local/share/chezmoi-ai diff` / `status` to verify.

**When you must re-render generated files (e.g. `.chezmoitemplates/**`), apply
only those targets** (`chezmoi -S ~/.local/share/chezmoi-ai apply dot_pi/`),
not the whole tree.

**Worktrees**: if `$PWD` contains `.worktrees/`, pass `-S "$PWD"` to all chezmoi commands.

## Template Syntax (CRITICAL)

**Never use `.args.X` / `.Args.X`** in agent prompt templates — they fail with
`map has no entry for key "args"`. Always use:

```chezmoitmpl
$ARGUMENTS
```

Applies to ALL user-provided arguments.

**Destination conditionals**: `{{ if contains "/.codex/" .chezmoi.targetFile }}Codex content{{ end }}`.

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

- `dot_agents/skills/*/SKILL.md.tmpl` ← `.chezmoitemplates/skills/*.tmpl`
- `dot_codex/AGENTS.md`, `dot_pi/agent/AGENTS.md`, `dot_config/opencode/AGENTS.md` ← `.chezmoitemplates/AGENTS.md.tmpl`

To modify: edit `.chezmoitemplates/prompts/**/*.tmpl`, then apply only the
generated targets (`chezmoi -S ~/.local/share/chezmoi-ai apply dot_agents/`).

## OpenCode Symlink Bridge

`~/.config/opencode/{skills,command}` are symlinks to `~/.agents/{skills,commands}`.
Edit `dot_agents/` templates + apply only `dot_config/opencode/` targets updates both.
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