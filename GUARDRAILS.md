# Guardrails for agents in this repo

This directory is chezmoi **source** for AI agent configuration. Destinations under
`~/.pi/`, `~/.codex/`, `~/.config/` and `~/.agents/` are generated and get overwritten.

## The agent MUST NOT

- Edit this file (GUARDRAILS.md) — humans write it, through review.
- Edit a generated destination (`~/.pi/`, `~/.codex/`, `~/.config/`, `~/.agents/`). Change the source here instead.
- Run bare `chezmoi apply` or bare `mise apply`. Bare apply may use the OS dotfiles repo as source.
- Run any apply with `--force`.
- Commit or modify `.env` files, or put real secret values in tracked files.
- Modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`) unless asked.
- Run `git commit --no-verify` or `git push --no-verify`.
- Force-push any branch, or run `git reset --hard` or `git clean -fdx` in this checkout.
- Run `rm -rf` outside `/tmp`.

## The agent MAY

- Read any file, run `git status`, `git diff`, `git log`, and inspect environment variables read-only.
- Run `mise run diff`, `mise run status`, `mise run verify`, and `chezmoi -S "$PWD" diff <destination>`.
- Edit source files here, then apply only the affected destinations:
  `mise run apply -- --exclude=scripts <destination>...`
- Create branches, stage, and commit on them.
- Write scratch files under `/tmp`.
