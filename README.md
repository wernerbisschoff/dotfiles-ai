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

One line — `bootstrap.sh` is standalone and installs mise + chezmoi itself:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/wernerbisschoff/dotfiles-ai/main/bootstrap.sh)
```

`bootstrap.sh` is idempotent. It arranges this repo at
`~/.local/share/chezmoi-ai` and applies it; run from any directory, no manual
clone is needed. May run independently of the main `dotfiles` repo.

## Toolchain

The AI CLIs (`pi`, `herdr`, `hunk`) are declared in `.mise.toml`. On a fresh
machine, `run_once_after_install-ai-mise-tools.sh` registers them as global
`mise` tools (`mise use -g`) so their shims are machine-wide. npm globals
(`open-codebase-index`, `@wernerbisschoff/libref`) install via
`run_once_after_npm-globals.sh`, and `run_once_after_seed-context-docs.sh`
pre-seeds libref docs.

## Layout notes

- `.chezmoitemplates/` is the source of truth: prompts, skills, rules, scripts
  that render into `dot_claude/`, `dot_codex/`, `dot_gemini/`,
  `dot_config/opencode/`. Never edit the generated `dot_*` files' *.md.tmpl
  directly — edit the `.chezmoitemplates/` core and re-apply.
- Root `CLAUDE.md` / `AGENTS.md` guide agents editing this repo.
- OS/shell/git targets (zsh, starship, ghostty, gitconfig, SSH) live in the
  main repo — do not move them here.