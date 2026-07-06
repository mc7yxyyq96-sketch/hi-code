# Hi Code Open-Source and Closed-Source Split

Version: 0.5.0
Date: 2026-07-04

This document defines the planned split between the GitHub open-source edition and the private/commercial closed-source edition.

## Open-Source Edition

The open-source edition should be useful as a local-first coding agent workbench.

Include:

- Core TypeScript runtime under `src/`
- CLI/TUI entry points
- Electron desktop shell
- Renderer UI for chat, timeline, diff, Git, model setup, store, plugins, skills, MCP
- OpenAI-compatible model profile configuration
- Local provider presets without API keys
- MCP stdio support and safe config UI
- Skill/plugin/agent manifest formats
- Store catalog schema and local/builtin catalog examples
- Runtime events and job queue
- Diff service and Git workflow
- Feature tests and test mocks
- Build scripts and packaging config
- Documentation and architecture plans

Do not include:

- Real user API keys
- `~/.vibe` runtime data
- User sessions, logs, auth state, private configs
- Private store credentials
- Paid/private plugin source URLs if not intended for public use
- Commercial license checks or billing code

Suggested public package name:

- Repository: `hi-code`
- Product: `Hi Code`
- NPM binary can remain `hicode` or migrate from old `vibe` naming after a compatibility decision.

## Closed-Source Edition

The closed-source edition can build on top of the open-source core.

Keep private:

- Cloud login/sync service
- Billing/subscription/license checks
- Commercial marketplace backend
- Private plugin, Skill, MCP, Agent packs
- Hosted model/API key proxy
- Enterprise auth and team admin
- Remote execution / cloud worktree infrastructure
- Usage analytics and product telemetry
- Private curated China mirror indexes if they require contracts or credentials
- Proprietary prompts/workflows that are part of paid features

## Boundary Rules

- Open-source code must run without the closed-source backend.
- Closed-source features should be optional adapters, not hard dependencies in the runtime.
- Any private endpoint should be configured through environment/config, not hardcoded.
- Public docs should explain local setup and extension formats.
- Private docs should explain commercial deployment, cloud services, and paid registry operations.

## Recommended Directory Strategy

Public repository:

```text
hi-code/
  src/
  electron/
  renderer/
  docs/
  test/
  build/
  package.json
  README.md
  AGENTS.md
  CLAUDE.md
  HI.md
```

Private repository or private package:

```text
hi-code-commercial/
  cloud/
  marketplace-service/
  license-service/
  private-store-catalogs/
  paid-skills/
  paid-agents/
  enterprise-connectors/
```

## Release Checklist Before GitHub

- Rename visible old `vibe` references where product-facing.
- Add license file.
- Add CONTRIBUTING.md.
- Add SECURITY.md.
- Add `.env.example`.
- Ensure README does not imply official OpenAI/Anthropic affiliation.
- Confirm no user secrets are present:

```bash
rg -n "sk-|apiKey|Authorization|token|password|secret" .
```

- Confirm clean build:

```bash
npm install
npm run build
node test/feature-tests.mjs
```
