# Security Policy

[简体中文](SECURITY.md) | **English**

Hi Code runs a coding agent that can read and write files and execute shell
commands on your machine. We take its security boundaries seriously.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on this repository. We aim to acknowledge
reports within a few days.

When reporting, please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof of concept if possible)
- Affected version (see `VERSION` / `package.json`)

## Scope

Security-relevant areas include:

- The permission system that gates `write_file`, `edit_file`, and `bash`
- Workspace path confinement (preventing writes/reads outside the project)
- The macOS `sandbox-exec` bash confinement
- MCP server configuration and the store install flow
- Local auth/credential storage under `~/.hicode`

## Handling secrets

- API keys live in `~/.hicode/config.json` (written `0600`) or environment
  variables — never commit them.
- Runtime data under `~/.hicode` (sessions, logs, auth) is private and is
  excluded from version control.
- Tool output shown in the app redacts obvious secrets (bearer tokens, keys),
  but review commands before approving them.

## Good practice for users

- Only point Hi Code at repositories you trust.
- Review shell commands and diffs before approving them.
- Use `--sandbox` (macOS) to confine bash file writes to the workspace.
- Prefer `default` permission mode over `yolo` for unfamiliar tasks.
