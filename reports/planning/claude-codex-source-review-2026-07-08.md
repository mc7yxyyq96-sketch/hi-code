# Claude Code / Codex Source Review Notes

Date: 2026-07-08
Scope: local archives supplied by the user:

- `/Users/jack/Downloads/claude-code-main.zip`
- `/Users/jack/Downloads/codex-main.zip`

## Review Boundary

This review is for product and architecture planning only. Hi Code must not copy proprietary code, UI assets, branding, prompts, docs, or implementation text from either project.

The target is behavioral and capability parity through clean-room, self-developed implementation.

## Archive Facts

| Project archive | Observed shape | Approximate scale | License signal |
| --- | --- | ---: | --- |
| Claude Code | Plugin, command, hook, settings, MDM, gateway, GitHub workflow, and documentation examples. The archive does not appear to contain the full closed desktop/CLI runtime source. | 216 files, 13 MB | `LICENSE.md` says copyright Anthropic PBC, all rights reserved. Treat as non-copyable reference. |
| Codex | Full open-source monorepo with Rust runtime, CLI/TUI, app-server protocol, SDKs, sandboxing, MCP, plugins, skills, CI, release, and packaging infrastructure. | 5370 files, 63 MB; about 94 Rust crates | Apache-2.0. Prefer architecture-level reference only to keep Hi Code self-developed. |
| Hi Code current | Electron + TypeScript CLI/TUI/runtime, tests, docs, industrial adapters, release builder, store, and desktop UI. | 195 git-tracked files | MIT |

## Claude Code Capabilities To Study

- Terminal-first agent entry with natural language task execution.
- Plugin structure with metadata, commands, agents, skills, and hooks.
- Official example plugins for feature development, code review, PR review, commit workflows, frontend design, plugin development, and security guidance.
- Hook concepts such as pre-tool-use security checks and session-start context injection.
- Enterprise examples: managed settings, MDM files, gateway configuration, and issue/PR automation.
- Community workflow surface: issue triage, duplicate detection, lifecycle comments, bug command, and marketplace metadata.

## Codex Capabilities To Study

- Rust monorepo split into small crates for runtime core, protocol, TUI, config, model providers, auth, sandboxing, skills, plugins, MCP, thread store, app server, SDKs, telemetry, and process hardening.
- CLI/TUI as first-class product surface, not just a desktop helper.
- App-server protocol and SDKs for Python and TypeScript.
- Thread/session model, message history, external agent sessions, rollout traces, and durable conversation state.
- Sandboxing and execution policy split for macOS/Linux/Windows behavior.
- MCP client/server integration and plugin/skill ecosystem.
- CI/release maturity: Bazel, Rust CI, SDK release workflows, code signing, dependency policy, codespell, blob-size policy, and release packaging.

## Hi Code Strategic Difference

Hi Code should not become only a Codex or Claude Code clone. Its differentiator stays:

- OpenAI-compatible and multi-provider desktop coding workbench.
- AI team, model debate, Patch Arena, and Job Center.
- Industrial engineering lifecycle: requirements, CAD/PCB/PLC/BIM/AVEVA plans, Domain Packs, quality gates, evidence, release package, and sample industrial projects.

The parity target means Hi Code must match the product depth and reliability of Codex and Claude Code in coding-agent fundamentals, then exceed them in industrial delivery workflows.

## Clean-Room Rules

- Use these archives to derive capability lists, product behavior, and architectural categories only.
- Do not copy code blocks, prompts, docs, filenames as API contracts, or visual assets unless they are generic concepts already independently implemented in Hi Code.
- Use Hi Code naming, schemas, IPC, renderer patterns, and safety model.
- Every parity item must be implemented with Hi Code tests and documentation.
- Code volume is not a goal by itself. Real modules, tests, platform handling, SDK surface, security logic, and industrial workflows should naturally increase the codebase size.
