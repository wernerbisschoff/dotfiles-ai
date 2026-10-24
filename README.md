# dotfiles-ai

[chezmoi](https://www.chezmoi.io/)-managed AI coding-agent configuration.
Sibling of [wernerbisschoff/dotfiles](https://github.com/wernerbisschoff/dotfiles)
(the OS/shell repo). This repo owns every `$HOME` target for AI agents:
skills, prompts, commands, extensions, and themes.

## Scope

| Source dir (chezmoi) | Renders to |
|---|---|
| `.chezmoitemplates/**` | shared template source of truth |
| `dot_claude/**` | `~/.claude/` |
| `dot_gemini/**` | `~/.gemini/` |
| `dot_pi/**` | `~/.pi/` |
| `private_dot_factory/**` | `~/.factory/` (0600) |
| `dot_codex/**` | `~/.codex/` |
| `private_dot_omp/**` | `~/.omp/` (0600) |
| `dot_cursor/**` | `~/.cursor/` |
| `dot_config/opencode/**` | `~/.config/opencode/` |
| `dot_config/pi/**` | `~/.config/pi/` |
| `dot_config/zsh/conf.d/050-ai-wrappers.zsh`, `060-pi-theme-sync.zsh` | `~/.config/zsh/conf.d/` |

Source dir: `~/.local/share/chezmoi-ai`. The main repo owns no AI targets and
the AI repo owns no OS/shell targets — the split is disjoint.

## Apply

```bash
cd ~/.local/share/chezmoi-ai && mise run apply   # == chezmoi -S ~/.local/share/chezmoi-ai apply -v
```

Tasks: `mise run diff|status|edit|verify|lint|format|fix|install`.

## Bootstrap

This repo is private, so `raw.githubusercontent.com` 404s and a
`curl | bash` of `bootstrap.sh` cannot work.

One line — one clone, then local `bootstrap.sh` (installs mise + chezmoi,
skips a second clone, applies). Needs SSH access to GitHub:

```bash
git clone git@github.com:wernerbisschoff/dotfiles-ai.git ~/.local/share/chezmoi-ai && ~/.local/share/chezmoi-ai/bootstrap.sh
```

`bootstrap.sh` is idempotent. If `~/.local/share/chezmoi-ai` already exists,
run that script only. Do not use `chezmoi init` after this clone — that would
clone again. May run independently of the main `dotfiles` repo.

## Toolchain

The AI CLIs (`pi`, `herdr`, `hunk`) are declared in `.mise.toml`. On a fresh
machine, `run_once_after_install-ai-mise-tools.sh` registers them as global
`mise` tools (`mise use -g`) so their shims are machine-wide. npm globals
(`@zvec/zvec-grep`, `@wernerbisschoff/libref`) install via
`run_once_after_npm-globals.sh`, and `run_once_after_seed-context-docs.sh`
pre-seeds libref docs.

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

- `.chezmoitemplates/` is the source of truth: prompts, skills, rules, scripts
  that render into `dot_claude/`, `dot_codex/`, `dot_gemini/`,
  `dot_config/opencode/`. Never edit the generated `dot_*` files' *.md.tmpl
  directly — edit the `.chezmoitemplates/` core and re-apply.
- Root `CLAUDE.md` / `AGENTS.md` guide agents editing this repo.
- OS/shell/git targets (zsh, starship, ghostty, gitconfig, SSH) live in the
  main repo — do not move them here.