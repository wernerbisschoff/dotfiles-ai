# dotfiles-ai

[chezmoi](https://www.chezmoi.io/)-managed AI coding-agent configuration.
This repo owns every `$HOME` target for the Pi and Codex agents: shared
skills, prompts, extensions, and themes. It is self-contained — clone it
alone and it works, with no OS/shell repo required.

## Scope

| Source dir (chezmoi) | Renders to |
| --- | --- |
| `dot_agents/skills/**` | `~/.agents/skills/` (shared skill library) |
| `dot_pi/**` | `~/.pi/` (extensions, themes, settings, MCP) |
| `dot_codex/**` | `~/.codex/` (AGENTS.md, rules; skills symlinked from `~/.agents/skills`) |
| `.chezmoitemplates/**` | shared template source of truth |
| `dot_config/pi/**` | `~/.config/pi/` (web-search config) |
| `dot_config/herdr/**`, `dot_config/hunk/**` | `~/.config/herdr/`, `~/.config/hunk/` |
| `dot_plannotator/**` | `~/.plannotator/` |
| `dot_config/zsh/conf.d/060-pi-theme-sync.zsh.tmpl`, `070-herdr.zsh` | `~/.config/zsh/conf.d/` |

Source dir: `~/.local/share/chezmoi-ai`. OS/shell targets (zsh, starship,
gitconfig, SSH) live in a separate private companion repo; nothing here needs it.

## Apply

```bash
cd ~/.local/share/chezmoi-ai
mise apply
```

Bare `mise apply` applies all configuration and eligible installation scripts.
To apply selected files without installers:

```bash
mise run apply -- --exclude=scripts ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
```

It uses the active checkout, including worktrees.
Review changes with `mise run diff` before applying.
Tasks: `mise run diff|status|edit|verify|test|lint|format|fix|install`.

### Before applying to a machine you already use

A full apply takes over `~/.pi`, `~/.codex`, and `~/.agents`, and runs the
installers: global `mise` tools (`pi`, `herdr`, `hunk`), npm globals, the
plannotator binary, and libref docs. Whatever already sits at those
destinations is replaced, not merged.

Preview with `mise run diff`, or apply a single target:

```bash
mise run apply -- --exclude=scripts ~/.pi/agent/mcp.json
```

## Bootstrap

Public repo — one line over HTTPS (installs mise + chezmoi if missing,
clones, applies). Idempotent. `bootstrap.sh` reads no stdin, so piping is safe:

```bash
curl -fsSL https://raw.githubusercontent.com/wernerbisschoff/dotfiles-ai/main/bootstrap.sh | bash
# or: git clone https://github.com/wernerbisschoff/dotfiles-ai.git ~/.local/share/chezmoi-ai && ~/.local/share/chezmoi-ai/bootstrap.sh
```

If `~/.local/share/chezmoi-ai` already exists, run that script only.
Do not use `chezmoi init` after this clone — that would clone again.
Needs no companion OS/shell repo; clone and run it on its own.

## Toolchain

The AI CLIs (`pi`, `herdr`, `hunk`) are declared as global `mise` tools by
`run_once_after_install-ai-mise-tools.sh` (`mise use -g`), so their shims stay
machine-wide. npm globals (`@zvec/zvec-grep`, `@wernerbisschoff/libref`)
install via `run_once_after_npm-globals.sh`, and
`run_once_after_seed-context-docs.sh` pre-seeds libref docs.

## Plannotator (custom build)

Binary is built from `wernerbisschoff/plannotator` branch
`review-live-refresh` (review UI Live toggle), not upstream releases.
Stock backup: `~/.plannotator/plannotator-stock-0.28.29`.
`dot_plannotator/config.json` keeps `autoUpdate: false` so the
custom binary never self-overwrites to upstream.

Rebuild after pulling the branch:

```bash
cd /tmp/plannotator && bun run build && bun build apps/hook/server/index.ts \
  --compile --no-compile-autoload-bunfig --target=bun-darwin-arm64 \
  --define "__CLI_VERSION__=\"<ver>-live.<n>\"" --outfile /tmp/plannotator-custom
codesign -f -s - /tmp/plannotator-custom  # re-sign or macOS kills it (SIGKILL)
cp /tmp/plannotator-custom ~/.local/bin/plannotator
```

## Layout notes

- `.chezmoitemplates/` holds shared skills, prompts, rules, and agent guidance.
  Tracked `dot_*` sources include these templates or contain standalone configuration.
  Chezmoi generates destinations under `$HOME`; never edit those generated files directly.
- Root `AGENTS.md` guides agents editing this repo.
- OS/shell/git targets (zsh, starship, ghostty, gitconfig, SSH) live in a separate
  private repo — do not move them here.
