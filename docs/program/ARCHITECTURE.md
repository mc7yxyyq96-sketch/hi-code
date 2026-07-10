# Hi Code Program Architecture

Status: Current-state map plus accepted migration target

Baseline: verified `0.6.0-alpha.7` candidate at `b044fdcecf1a153393cce29d7267eb2205c99dec`

## Architectural Objective

One engine must support Electron, CLI, TUI, future SDK/app-server clients, isolated provider execution, and industrial engineering workflows. Runtime events, permissions, artifacts, gates, and release evidence are shared contracts. UI surfaces and tool adapters are clients of those contracts, not alternate implementations of them.

## Current Runtime Topology

```mermaid
flowchart LR
  E["Electron renderer"] --> P["Validated preload API"]
  P --> I["Normalized Electron IPC"]
  I --> S["Main-process services"]
  C["CLI entry"] --> R["Shared runtime"]
  T["Ink TUI"] --> R
  S --> R
  R --> L["OpenAI-compatible LLM client"]
  R --> X["Permission-gated tools"]
  X --> F["Workspace, Git, Bash, MCP"]
  R --> RP["Runtime Protocol envelope"]
  RP --> ES["Legacy append-only JSONL"]
  RP --> TS["Typed Thread / Event / Message stores"]
  S --> J["Job Center and domain services"]
  J --> A["Artifacts, gates, and releases"]
```

The diagram describes implemented connections. It does not imply that every client consumes the protocol as its sole data source yet.

## Production Entrypoints

- Package and CLI metadata: `package.json`
- CLI: `src/index.ts` compiled to `dist/index.js`
- TUI: `src/tui.tsx`
- Electron main: `electron/main.mjs`
- Electron preload: `electron/preload.cjs`
- Renderer document: `renderer/index.html`
- Renderer bootstrap: `renderer/renderer.js` and `renderer/app/bootstrap.js`

Root-level legacy `main.mjs`, `renderer.js`, and `index.html` are not production entrypoints. Archived v0.4 files live under `legacy/v0.4/` and must not be reintroduced into package metadata.

## Current Boundaries

### Core runtime

`src/runtime.ts` orchestrates model turns, permissions, tool calls, events, and session state. `src/agent.ts`, `src/llm.ts`, and `src/tools/` provide model and tool behavior. `src/process-env.ts` builds minimal child-process environments.

### Protocol and persistence

`src/runtime-protocol.ts` defines versioned event envelopes. `src/runtime-event-store.ts` preserves legacy JSONL while synchronizing validated events into the typed store. `src/runtime-stores.ts` owns typed thread, event, and normalized model-message contracts. `src/session-store.ts` remains the compatibility facade. `src/turn-state-machine.ts` derives conservative crash, approval, and tool recovery from durable events; `src/recovery.ts` projects those plans through the compatibility IPC and treats evidence-poor legacy failures as inspection-only.

HC-RUN-201 moved assistant text to first-class protocol events. HC-RUN-202 adds exact hidden `message.appended` records and reconstructs full system/user/assistant/tool context without session JSON. Streams created before normalized messages remain read-only rather than receiving guessed context.

### Electron shell

`electron/main.mjs` owns window lifecycle and service composition. `electron/ipc/register-ipc-handlers.mjs` is the single handler registration point. Service modules under `electron/services/` validate and delegate runtime, workspace, Git, Store, Job, Provider, Arena, industrial, gate, sample, and release operations.

`electron/preload.cjs` exposes a bounded API. The renderer never receives raw `ipcRenderer` or Node access.

### Renderer

`renderer/app/state.js` owns explicit renderer state. `renderer/api/hicode-api.js` normalizes preload calls and failures. Components under `renderer/components/` own panel rendering and user actions. `renderer/renderer.js` remains a compatibility composition layer while behavior migrates into components.

### Engineering services

The Job Center is the durable execution record. Providers, isolated worktrees, Patch Arena, industrial projects, Domain Packs, agent teams, tool adapters, quality gates, sample generation, and release packaging write events and artifacts through their existing stores and Electron services.

## Persistence Map

| Data | Current location | Authority today | Migration direction |
| --- | --- | --- | --- |
| User config and credentials | Hi Code app data / config files with restricted permissions | Config service | Move secret material to platform secure storage |
| Full chat sessions | Local session JSON plus typed message snapshots | Compatibility write plus complete resume source | Remove legacy authority only after a later verified migration |
| Runtime events | Legacy `~/.hicode/runtime-events/<session>.jsonl` plus typed event records | Append-only execution authority with non-destructive import | Retain legacy source for rollback during v0.6 |
| Typed runtime context | `~/.hicode/runtime-store-v2/<session>/` | Thread metadata, exact model messages, normalized events | Backend remains replaceable behind interfaces |
| Job Center | App-data Job Store | Job execution and artifact audit | Retain with protocol references |
| Industrial project | Workspace `.hicode/project.json` | Project artifact and traceability model | Retain with schema migrations |
| Generated artifacts | Workspace `.hicode/artifacts`, generated docs, releases | File plus metadata/evidence | Retain; strengthen checksums and provenance |

No migration may silently discard a legacy store. Importers are idempotent, preserve original files until verification, and record the source format and migration result.

## Accepted Target

```mermaid
flowchart TB
  Clients["Electron / CLI / TUI / SDK"] --> Engine["Agent Engine"]
  Engine --> Sink["RuntimeEventSink"]
  Sink --> Protocol["Runtime Protocol v2-compatible stream"]
  Protocol --> Stores["ThreadStore / EventStore / MessageStore"]
  Engine --> Policy["Permission and sandbox policy"]
  Engine --> Providers["Provider adapters"]
  Engine --> Tools["Tool and industrial adapters"]
  Stores --> Jobs["Job Center"]
  Jobs --> Gates["Quality gates and evidence"]
  Gates --> Release["Release Builder"]
  Protocol --> Clients
```

The target is implemented through compatibility layers:

1. HC-RUN-201 injects `RuntimeEventSink`, emits assistant output, and migrates Electron/CLI/TUI projections without removing legacy event fields.
2. Runtime store tasks introduce typed store interfaces and import existing JSON/JSONL data.
3. Desktop, CLI, and TUI migrate to protocol-derived projections one surface at a time.
4. Provider and tool execution continue to use Job Center, worktree isolation, permission, and path boundaries.
5. Legacy output/session paths are removed only after replay, recovery, and client parity tests pass.

## Runtime Contract Rules

- Event IDs, session IDs, turn IDs, and sequence numbers are stable and validated.
- Per-session sequence is monotonic; concurrent sessions cannot share mutable output buffers.
- Assistant text is data in `assistant.delta` and `assistant.completed` style events, never inferred from global stdout.
- Tool output, approval requests, diffs, errors, and completion retain typed status and visibility.
- Append failure is observable and cannot be reported as durable success.
- Compatibility fields may remain during migration but cannot become a second authority.

## Runtime Client Projection

`RuntimeEventBus` is the in-process fan-out contract. Runtime persistence happens before delivery, so a failed UI subscriber cannot turn a durable event into a failed Agent turn. Subscribers may filter by session, turn, and event type; listener failures are isolated and reported without stopping other clients.

`connectAssistantOutput(...)` is the typed client boundary. `connectAssistantTextOutput(...)` is the compatibility projection used by the three current clients. It renders deltas once, falls back to completed content for non-streaming providers, and never repeats full content after deltas.

Electron keeps its existing `output` and `tool-event` IPC channels while changing their source to protocol projections. CLI and TUI instantiate private buses. The global desktop/TUI console bridges remain temporary command/tool compatibility paths only; they are not assistant message authorities.

## Security Architecture

- Electron uses `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing, local `loadFile`, CSP, navigation denial, and bounded preload APIs.
- All IPC requests pass argument validation and normalized error handling.
- Workspace operations resolve real paths and reject symlink/path escape.
- Mutating tools and external adapters require explicit permission unless the user selected a documented higher-trust mode.
- Child processes receive minimal allowlisted environments; tokens, secrets, passwords, keys, and unknown sensitive variables are excluded by default.
- Store and Domain Pack remote installs require HTTPS, safe destinations, and manifest validation. Remote manifests cannot inject local source paths or automatic scripts.
- Commercial adapters never bypass licensing, VPN, identity, or enterprise authorization. Plaintext credentials are not persisted.
- Logs and evidence redact secret-like data before persistence.

## Quality And Release Architecture

`scripts/verify.mjs` is package-manager independent and runs the repository's build, syntax, feature, service, runtime, renderer, entrypoint, security, industrial, DoD, and usage suites. `scripts/scan-dod.mjs` scans the full delivery tree for blocking skeleton risks. `scripts/audit-production.mjs` audits only package-lock production packages through the HTTPS npm advisory endpoint.

`npm run program:baseline` archives exact command logs and hashes under `reports/evidence/baseline/`. Release promotion requires a fresh candidate capture, real Electron E2E, platform package smoke tests, and honest unresolved-risk handling.

## Industrial Extension Contract

Industrial modules may add schemas, templates, adapter capability declarations, diagnostics, artifacts, and gates. They may not create a parallel runtime or permission system. Every result carries provenance and one of the truthful execution states. SolidWorks and AVEVA remain bridge/external-required integrations until a licensed local connector is configured, authorized, and verified.

No new industrial domain implementation begins before HC-RUN-201 is accepted.

## Architectural Non-Goals

- No big-bang rewrite of Electron, renderer, runtime, or persistence.
- No copied Codex or Claude Code implementation.
- No feature-count or repository-size parity claim without verified behavior.
- No automatic merge from Patch Arena.
- No real industrial execution claim based only on a generated plan.
- No weakening of tests, security, DoD, or skeleton detection to make a release pass.
