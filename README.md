# dotfiles-ai

[chezmoi](https://www.chezmoi.io/)-managed AI coding-agent configuration.
Sibling of [wernerbisschoff/dotfiles](https://github.com/wernerbisschoff/dotfiles)
(the OS/shell repo). This repo owns every `$HOME` target for the Pi and
Codex agents: shared skills, prompts, extensions, and themes.

## Scope

| Source dir (chezmoi) | Renders to |
| --- | --- |
| `dot_agents/skills/**` | `~/.agents/skills/` (shared skill library) |
| `dot_pi/**` | `~/.pi/` (extensions, themes, settings, MCP) |
| `dot_codex/**` | `~/.codex/` (AGENTS.md, rules; skills symlinked from `~/.agents/skills`) |
| `.chezmoitemplates/**` | shared template source of truth |
| `dot_config/pi/**` | `~/.config/pi/` (web-search config) |
| `dot_config/opencode/**` | `~/.config/opencode/` (skills symlinked from `~/.agents/skills`) |
| `dot_config/herdr/**`, `dot_config/hunk/**` | `~/.config/herdr/`, `~/.config/hunk/` |
| `dot_plannotator/**` | `~/.plannotator/` |
| `dot_config/zsh/conf.d/060-pi-theme-sync.zsh`, `070-herdr.zsh` | `~/.config/zsh/conf.d/` |

Source dir: `~/.local/share/chezmoi-ai`. The main repo owns no AI targets and
the AI repo owns no OS/shell targets — the split is disjoint.

## Apply

```bash
cd ~/.local/share/chezmoi-ai && mise run apply   # == chezmoi -S ~/.local/share/chezmoi-ai apply -v
```

Tasks: `mise run diff|status|edit|verify|lint|format|fix|install`.

## Bootstrap

Public repo — one line over HTTPS (installs mise + chezmoi if missing,
clones, applies). Idempotent. `bootstrap.sh` reads no stdin, so piping is safe:

```bash
curl -fsSL https://raw.githubusercontent.com/wernerbisschoff/dotfiles-ai/main/bootstrap.sh | bash
# or: git clone https://github.com/wernerbisschoff/dotfiles-ai.git ~/.local/share/chezmoi-ai && ~/.local/share/chezmoi-ai/bootstrap.sh
```

If `~/.local/share/chezmoi-ai` already exists, run that script only.
Do not use `chezmoi init` after this clone — that would clone again.
May run independently of the main `dotfiles` repo.

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

- `.chezmoitemplates/` is the source of truth: skills, prompts, rules, and
  the shared `AGENTS.md` that renders into `dot_pi/`, `dot_codex/`, and
  `dot_config/opencode/`. Never edit the generated `dot_*` outputs directly —
  edit the `.chezmoitemplates/` core and re-apply.
- Root `AGENTS.md` guides agents editing this repo.
- OS/shell/git targets (zsh, starship, ghostty, gitconfig, SSH) live in the
  main repo — do not move them here.
