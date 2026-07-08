# Hi Code Product Parity Target

Date: 2026-07-07
Owner: Hi Code engineering

## Product Standard

Hi Code must be developed toward the full product level of Claude Code and Codex, not toward a demo shell.

The target is:

- Codex / Claude Code level coding-agent experience.
- Real runtime, session recovery, task tracking, diff review, command execution, tool permission, MCP, Store, Plugin, Skill, and Git workflows.
- Industrial engineering differentiation on top of software development: CAD, PCB, PLC, BIM, AVEVA bridge planning, quality gates, release evidence, and auditable delivery packages.
- Production-grade implementation depth: real core logic, Electron IPC/API, renderer UI, persistence, tests, docs, safety boundaries, and release checks.

## Non-Negotiable Bar

- No fake buttons.
- No mock-only production path.
- No placeholder modules in production routes.
- No false claim that a simulated or dry-run industrial artifact is real.
- No fake-passed quality gates.
- No skipped security boundary for convenience.
- No UI entry without a working path or a clear disabled reason.

## Codebase Scale Principle

The codebase should grow to the level required by a full desktop engineering workbench. Code volume must come from real product surface, tests, platform handling, safety logic, and maintainable architecture, not duplicated filler.

Every important capability should have:

- Core implementation.
- Desktop IPC/API.
- Renderer behavior.
- Persistence.
- Error handling.
- Tests.
- Documentation.
- Acceptance commands.

## Next-Version Focus

The next versions should prioritize parity-critical areas before adding broad new industrial tools:

- Stronger conversation/session model with reliable recovery and background task visibility.
- Better task/job center integration for every runtime execution.
- Provider abstraction that can later safely connect Codex CLI, Claude Code, local models, and internal runtime.
- Patch Arena and review workflows that feel as polished as mainstream coding agents.
- Settings, Store, Plugin, Skill, MCP, and industrial workbench UI that remain stable in small and large windows.
- Release and update flow suitable for public open-source users.
