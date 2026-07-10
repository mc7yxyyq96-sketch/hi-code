# Hi Code Claude/Codex Parity Roadmap

Date: 2026-07-08
Owner: Hi Code engineering

## North Star

Hi Code v0.5.1/v0.5.2 already has a real desktop/CLI runtime, Store, MCP, Job Center, Patch Arena, industrial project model, industrial adapters, quality gates, release builder, and tests.

The next target is not a visual clone. It is product-level parity with Claude Code and Codex through self-developed implementation:

- Match Codex/Claude Code in coding-agent fundamentals.
- Keep Hi Code's industrial AI engineering workbench direction.
- Grow codebase scale through real runtime, safety, SDK, plugin, packaging, enterprise, and industrial modules.
- Never add filler code, fake buttons, fake gates, mock-only production paths, or copied code.

## Non-Copying Commitment

Claude Code archive: treat as non-copyable product/plugin reference because its local license states Anthropic copyright and all rights reserved.

Codex archive: Apache-2.0, but Hi Code will still use a clean-room approach. Architecture ideas can be studied; implementation must be Hi Code-native.

Allowed:

- Capability matrices.
- Behavioral specs.
- Independently named APIs.
- Hi Code-specific UI/UX and schemas.

Not allowed:

- Direct source copying.
- Prompt or documentation cloning.
- Asset or branding reuse.
- Byte-for-byte UI recreation.
- Claiming closed Claude Code internals are implemented when only public examples were inspected.

## Product Gaps

### Current Hi Code Strengths

- Electron desktop with secure preload and IPC.
- TypeScript CLI/TUI/runtime.
- OpenAI-compatible provider configuration.
- Store, Plugin, Skill, Agent, MCP, and capability pages.
- Runtime queue, Job Center, Patch Arena, worktree isolation.
- Industrial project, Domain Packs, adapters, quality gates, release packages.
- DoD/Skeleton detector and broad test suite.

### Gap Against Codex

- Runtime core is not yet split into a low-level protocol/app-server architecture.
- CLI/TUI is functional but much smaller than Codex's Rust TUI and app-server model.
- SDK surface is not yet first-class for Python/TypeScript automation.
- Sandboxing is not yet cross-platform at Codex depth.
- Auth, keyring, cloud task, telemetry, rollout trace, and thread store are less mature.
- CI/release matrix is lighter than Codex's multi-platform release machinery.

### Gap Against Claude Code Public Archive

- Plugin ecosystem exists but lacks Claude-style command/agent/hook authoring depth.
- Hook system is not yet a first-class user/admin policy layer.
- Enterprise managed settings, MDM, gateway templates, and org policies need productization.
- GitHub issue/PR automation workflows are not yet part of the public Hi Code repo.
- Plugin developer toolkit and validation workflow need to be much stronger.

## Version Roadmap

### v0.5.2: Stabilization Release

Goal: finish current public release quality.

Focus:

- Session/recent conversation reliability.
- Empty response visibility and image attachment reliability.
- Store lifecycle and Chinese summaries.
- UI small-window polish.
- Build/verify/release check stability.
- README, screenshots, and release notes.

Exit criteria:

- `npm run build`
- `npm run verify`
- `npm run release:check`
- Recent sessions can be opened after leaving chat.
- New chats create durable runtime sessions.
- Public README is not misleading.

### v0.6: Runtime Core Parity

Goal: make the coding-agent core feel reliable at Codex/Claude level.

Current first slice:

- `src/runtime-protocol.ts` defines the versioned runtime event envelope.
- `src/runtime.ts` attaches `payload.runtimeProtocol` to existing runtime events without breaking current UI consumers.
- `src/runtime-event-store.ts` persists protocol events as append-only JSONL for replay and recovery.
- Recent sessions now surface event-only sessions as replay-only recovery entries when the full chat JSON is unavailable.
- CLI/TUI `/sessions` lists event-only replay entries, and `/resume <id>` opens them as read-only transcript replay instead of silently failing.
- Saved session resume continues protocol event sequence numbers from the append-only store.
- Desktop recoverable task listing now reads failed/interrupted/denied turns from the append-only protocol store and merges legacy runtime logs for migration safety.
- `test/runtime-protocol-tests.mjs` verifies schema helpers and real runtime event emission.

Build:

- Runtime protocol boundary: `core-api`, `runtime-protocol`, `event-stream`, `turn-store`.
- Durable session/thread store with append-only events and replay.
- Clear separation of model output, tool events, diffs, approvals, and UI timeline.
- Unified command router for slash commands, native actions, and tool invocations.
- Robust image/file attachment pipeline with model capability checks.
- Recovery after app restart, crash, model failure, and interrupted shell command.
- Stronger CLI/TUI parity: session list, resume, interrupt, approve/deny, diff review, model config, MCP status.

Acceptance:

- CLI and desktop use the same runtime protocol.
- Every user turn can be replayed from persisted events.
- No desktop-only runtime state needed to open a recent conversation.
- Feature tests cover crash/restart/resume paths.

### v0.7: Plugin / Skill / Hook Ecosystem

Goal: reach Claude Code-style extensibility with Hi Code-native safety.

Build:

- `hicode.plugin.json` v2 schema for commands, agents, skills, hooks, MCP, templates, settings, permissions.
- Plugin authoring toolkit: scaffold, validate, pack, install from local zip, install from HTTPS, uninstall, update.
- Hook engine: `SessionStart`, `BeforeToolUse`, `AfterToolUse`, `BeforeCommit`, `BeforeRelease`, `OnError`.
- Managed hooks/policies for enterprise mode.
- Plugin dev panel in desktop and CLI commands.
- Skill runner with metadata, examples, tests, and safety review.
- Store trust levels: built-in, curated, remote verified, remote unverified.

Acceptance:

- A real plugin can add a command, a skill, a hook, and a managed policy.
- Hooks can block risky commands without editing core code.
- Plugin validation catches unsafe paths, scripts, missing docs, missing tests, and permission overreach.

### v0.8: SDK / App Server / External Agent Integration

Goal: make Hi Code programmable and ready for Codex CLI / Claude Code collaboration without unsafe coupling.

Build:

- Local app-server daemon with authenticated localhost transport.
- TypeScript SDK and Python SDK for creating sessions, streaming turns, approving tools, reading jobs, reading artifacts.
- External agent adapter interface for Codex CLI, Claude Code, local model runners, and custom internal runtimes.
- Worktree runner as mandatory default for external agent writes.
- Patch Arena integration for external agent candidates.
- Thread handoff: desktop ↔ CLI ↔ SDK.
- Structured output schemas and binary artifact handling.

Acceptance:

- SDK sample can run a Hi Code task and stream events.
- External agent adapters can be configured as `not_configured`, `dry_run`, or `enabled`.
- No external agent can write directly to main workspace unless user chooses direct mode.

### v0.9: Enterprise / Security / Release Infrastructure

Goal: match serious tool deployment expectations.

Build:

- Keyring-backed secrets for desktop and CLI.
- Enterprise policy file: permissions, MCP allowlist, plugin trust, network policy, hook policy, logging policy.
- MDM examples for macOS and Windows.
- Gateway/proxy examples for model routing.
- Sandboxing hardening for macOS/Linux/Windows.
- Telemetry/event ledger with local-first controls.
- CI matrix for macOS/Windows/Linux, signing readiness, checksums, SBOM, dependency audit, release evidence.
- GitHub issue/PR automation for triage, duplicate detection, release notes, and docs checks.

Acceptance:

- Admin can enforce safe defaults without code changes.
- Release package includes checksums, SBOM/evidence, and platform artifacts.
- CI protects build, tests, package integrity, docs, and release metadata.

### v1.0: Industrial Engineering Workbench

Goal: exceed Codex/Claude Code by shipping a credible engineering delivery system.

Build:

- Industrial artifact graph: requirements, design, CAD, PCB, PLC, BIM, process, electrical, BOM, tests, gates, release.
- Stronger Domain Pack marketplace and validation.
- Real FreeCAD/KiCad/OpenPLC/IfcOpenShell paths where tools are installed.
- Commercial bridge frameworks for SolidWorks, AVEVA, Altium, Revit, CODESYS, TwinCAT with no fake execution.
- Release Package 2.0 with customer-facing evidence binder.
- Industrial Control Box Demo 2.0 and at least two more sample projects.
- Human approval and compliance checklist system.

Acceptance:

- User can generate, review, gate, and package a multi-domain sample project.
- All simulated artifacts are visibly marked.
- Failed gates block release.
- Evidence is auditable from Job Center to release folder.

## Standing Development Rules

Every future sprint must start from this roadmap and update it when scope changes.

Each feature must include:

- Core logic.
- Electron IPC/API when desktop-visible.
- Renderer UI when user-visible.
- CLI/TUI path when runtime-visible.
- Persistence.
- Error handling.
- Security boundaries.
- Tests.
- Documentation.
- Acceptance commands.

Required checks for product code:

- `npm run build`
- `npm run verify`
- `npm run release:check`
- Focused tests for the touched subsystem.

## Immediate Next Backlog

1. Finish v0.5.2 release candidate.
2. Start v0.6 runtime protocol extraction.
3. Add durable turn/event replay for recent sessions.
4. Add CLI/TUI session browser and resume parity.
5. Draft `hicode.plugin.json` v2 and hook engine design.
6. Draft SDK/app-server protocol.
7. Expand CI/release evidence and packaging.
