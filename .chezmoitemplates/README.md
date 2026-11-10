# Shared instruction templates

Edit shared instructions here, then apply only their affected destinations.
This repository supports Pi and Codex.

## Sources and destinations

| Content | Source | Destination |
| --- | --- | --- |
| Shared guidance | `.chezmoitemplates/AGENTS.md.tmpl` | Included by both agent wrappers |
| Agent wrappers | `dot_pi/agent/AGENTS.md.tmpl`, `dot_codex/AGENTS.md.tmpl` | `~/.pi/agent/AGENTS.md`, `~/.codex/AGENTS.md` |
| Shared skill bodies | `.chezmoitemplates/skills/*.tmpl` | Included by `dot_agents/skills/*/SKILL.md.tmpl` |
| Standalone skills | `dot_agents/skills/*` | `~/.agents/skills/*` |
| Reusable prompts | `.chezmoitemplates/prompts/tools/*.tmpl` | Included by their source wrappers |
| Rule fragments | `.chezmoitemplates/rules/*.tmpl` | Included where needed |
| Scripts and tests | `.chezmoitemplates/scripts/`, `.chezmoitemplates/tests/` | Source-only unless included by a wrapper |

Files under `dot_*` are tracked sources, not generated output.
Inspect a skill wrapper before deciding whether to edit its source or an included template.
Never edit generated files under the home directory.

## Template syntax

Include another template relative to this directory:

```chezmoitmpl
{{ template "skills/commit.tmpl" . }}
```

Use `.chezmoi.targetFile` for destination-specific content:

```chezmoitmpl
{{ if contains "/.codex/" .chezmoi.targetFile }}Codex-specific content{{ end }}
```

`.chezmoi.sourceDir` is the source checkout; `.chezmoi.homeDir` is the home directory.
Use `$ARGUMENTS` only when the destination prompt runtime supports that substitution.
Skill bodies use the current request from the harness.

## Verify and apply

Run from the active checkout, including worktrees:

```bash
mise run test
mise run lint
chezmoi -S "$PWD" diff ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
mise run apply -- --exclude=scripts ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
chezmoi -S "$PWD" status ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md
```

Bare `mise apply` applies all configuration and eligible installation scripts.
Use explicit destinations and `--exclude=scripts` for scoped template updates.
For a skill change, select its `~/.agents/skills/<directory>/SKILL.md` destination instead.
Preview rendered templates with `chezmoi -S "$PWD" cat <destination>`.
Do not print rendered credentials during verification.
