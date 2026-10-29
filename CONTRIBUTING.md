# Contributing

## Commit message convention

This repo uses [Conventional Commits 1.0](https://www.conventionalcommits.org/)
with an [emoji prefix](https://gitmoji.dev/) for visual scannability.

### Format

```
<emoji> <type>[(<scope>)][!]: <subject>

<body — explain WHY, wrap at 72 chars/line>

<footer — BREAKING CHANGE: …, Refs: #123, etc.>
```

### Type → emoji

| Type       | Emoji | Meaning                                          |
| ---------- | ----- | ------------------------------------------------ |
| `feat`     | ✨    | New user-visible feature                         |
| `fix`      | 🐛    | Bug fix                                          |
| `docs`     | 📚    | Documentation only                               |
| `style`    | 🎨    | Formatting/whitespace (no logic change)          |
| `refactor` | 🔁    | Code change with no behavior change              |
| `perf`     | 🚀    | Performance improvement                          |
| `test`     | ✅    | Tests added or corrected                         |
| `build`    | 📦    | Build system or dependency change                |
| `ci`       | 👷    | CI configuration or scripts                      |
| `chore`    | 🔧    | Tooling, maintenance, non-source tasks           |
| `revert`   | ⏪    | Revert a prior commit                            |
| breaking   | 💥    | Backward-incompatible (use `type!:` + footer)    |
| security   | 🔒    | Security hardening (treat as `fix`)              |

### Rules

- One logical change per commit. Split unrelated changes.
- **Subject**: imperative, lowercase after the colon, no trailing period, ≤ 50 chars.
- **Scope** *(optional)*: short noun — `pi`, `codex`, `chezmoi`, `agents`, etc.
- **Breaking changes**: append `!` after the type/scope **and** add a `BREAKING CHANGE: <explanation>` footer.
- **Body** *(optional)*: explain *why*, not *what*. Wrap at 72 chars/line.
- **Footer** *(optional)*: `BREAKING CHANGE: …`, `Refs: #123`, etc.

### Examples

```text
✨ feat(pi): add commit-convention lookup in commit skill
🐛 fix(omp): handle null theme on first launch
📚 docs(agents): document zg search toolchain
🔁 refactor(opencode): rename footer file for clarity
🚀 perf(pi): skip jq on small contracts
✅ test(commit): cover conventional+emoji prefix parsing
💥 feat(api)!: drop legacy v1 endpoints
🔒 fix(pi): mask sensitive paths in error messages
```

### Why

- **Conventional types** let tooling (release-please, commitlint, semantic-release)
  derive versions and changelogs automatically from the log.
- **Emoji prefixes** make `git log --oneline` scannable — the type cue lands
  before your eye reaches the prose.
- **Scope** keeps the diff domain explicit in monorepos like this one.

## Project layout

See [`README.md`](./README.md) for scope and the `mise run` apply workflow.
