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

An OS/shell repo (private, source `~/.local/share/chezmoi`) owns zsh, starship,
gitconfig, SSH, and toolchain targets. Do not move those targets here.

### Common source → destination

| Edit this... | Source (in this repo) |
|---|---|
| `~/.agents/skills/*/SKILL.md` | `dot_agents/skills/*/SKILL.md.tmpl` |
| `~/.codex/AGENTS.md` | `dot_codex/AGENTS.md.tmpl` |
| `~/.pi/agent/settings.json` | `dot_pi/agent/settings.json` |

## Slash Commands vs Skills

Prefer slash commands for short, explicitly invoked `tools-*` prompts.
Use skills for reusable workflows with supporting scripts or reference files.
Pi and Codex load skill metadata first, then load the body when needed.
Write specific skill descriptions so the agent can select the correct workflow.

## Editing Workflow

1. Edit source files in the active checkout.
2. Preview the affected destination files.
3. For agent edits, apply only those targets and explicitly exclude installation scripts.

   ```bash
   # Run from this checkout, including when using a worktree.
   chezmoi -S "$PWD" diff ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
   mise run apply -- --exclude=scripts ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
   chezmoi -S "$PWD" status ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
   ```

Never run bare `chezmoi apply`: its default source can be another checkout.
Use `-S` with the active checkout for direct chezmoi commands.
Bare `mise apply` applies all configuration and eligible installation scripts from this checkout.
Use full apply only when requested. Never run a full forced apply.
Use destination paths, or add `--source-path` when supplying source paths.
Review live settings changes before applying `~/.pi/agent/settings.json`; Pi also writes this managed file.

## Template Syntax (CRITICAL)

Never use `.args.X` or `.Args.X` in chezmoi templates; those variables do not exist.
Use `$ARGUMENTS` only in prompt templates whose agent runtime supports substitution.
Skill bodies receive the current request through the harness; do not assume placeholder expansion.

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

## Source Templates and Generated Destinations

`dot_*` files are tracked chezmoi sources, not generated output.
Edit `.chezmoitemplates/skills/*.tmpl` for shared skill bodies.
Edit `.chezmoitemplates/AGENTS.md.tmpl` for shared agent guidance.
Edit `dot_pi/agent/AGENTS.md.tmpl` or `dot_codex/AGENTS.md.tmpl` for agent-specific guidance.
Some skills contain their full source under `dot_agents/skills/`; inspect their wrapper before choosing a file.

Chezmoi generates files under `~/.agents/`, `~/.pi/`, and `~/.codex/`.
Apply the affected destination files, not an unrelated source directory.
Never edit generated destinations directly.

## Cross-Platform

Use `perl -i -pe` (not `sed -i`) for in-place edits — different syntax on macOS vs Linux.

## Commits

Follow [`CONTRIBUTING.md`](./CONTRIBUTING.md) for commit message conventions (emoji prefix + Conventional Commits) when creating commits.

## Common Commands

```bash
mise apply                              # full apply, including eligible installers
mise run apply -- --exclude=scripts <destination>...  # scoped agent edits
mise run diff|status|verify               # uses the active checkout
chezmoi -S "$PWD" edit <destination>      # open the source in $EDITOR
chezmoi -S "$PWD" add ~/.path/file        # track a new file from home
```

## Local Patches: pi npm packages

Two scripts patch packages under `~/.pi/agent/npm/node_modules`, which
`pi update --all` rewrites wholesale. Both run on every apply and exit 0 with a
warning when upstream has moved the target line.

`run_after_patch-acp-summary-budget.sh` raises the summary token ceiling inside
`billion-context-pi-lean`. Upstream (0.2.3 and 0.3.0) budgets every summary at
`ceil(summaryMaxChars / 3)` = 6667 tokens and passes no reasoning level, so reasoning
models exhaust that budget and compression fails with `hit its output limit`; after
the patch the same ranges succeed. `compress.maxSummaryLength` in `~/.pi/acp.json`
cannot help: it only validates the finished summary.

`run_after_patch-pi-lens-tool-schema.sh` gives pi-lens `lsp_navigation` a concrete
`items` type for `commandArguments` (upstream 4.4.11 serialises `{}`). OpenAI-compatible
upstreams reject the whole tool list with `invalid_function_parameters`, so every
request that carries it fails — including ACP summaries that never call a tool. The
type list stays scalar-only: object/array branches would also need
`additionalProperties: false` and nested `items`.

Pi loads packages at startup, so restart pi after patching. To re-apply both patches
right after an update, use `mise run patch-pi`; `mise run pi-update` (`pi update --all`)
and `mise run upgrade-ai` do this for you. Bare `pi update --all` does not.

## Documentation Lookup

Prefer version-matched local documentation, including `libref query <lib> "<topic>"`.
Use current official documentation when local references are missing or unsuitable.
Register a library only when useful, with applicable filesystem and network permission.