# Agent Providers

Sprint 3A adds the Provider layer that Hi Code will use to run work through different AI execution backends without coupling the rest of the app to one runtime.

## Provider Design

The core types live in `src/agent-provider.ts`:

- `AgentProvider`: provider implementation contract.
- `ProviderCapability`: advertised runtime capabilities such as `runtime.queue`, `job.center`, `external.cli`, and `local.model`.
- `ProviderRunRequest`: normalized input for a provider run.
- `ProviderRunResult`: durable result shape returned by provider execution.
- `ProviderMessage`: structured conversation messages.
- `ProviderArtifact`: provider-produced files, patches, or changed-file summaries.
- `ProviderToolCall`: tool execution record.
- `ProviderError`: normalized error object with code and message.

`AgentProviderRegistry` owns registration and state:

- `registerProvider(provider)`
- `getProvider(id)`
- `listProviders()`
- `enableProvider(id)`
- `disableProvider(id)`
- `configureProvider(id, config)`
- `validateProviderConfig(id, config?)`
- `runProvider(id, request)`
- `cancelProvider(id, request)`

Renderer and Electron callers only receive public `ProviderDescriptor` objects. Provider config values are persisted with `0600` permissions but are not returned to the renderer.

## Provider Lifecycle

1. Main process creates the registry in `electron/services/provider-service.mjs`.
2. Built-in provider descriptors are registered.
3. Saved config from `~/.vibe/providers/providers.json` is applied.
4. Renderer or future orchestration calls `provider:run`.
5. The provider creates or attaches a Job Center job.
6. Provider logs become `JobEvent` records.
7. Provider artifacts become Job artifacts under allowed app data roots.
8. Provider failures write both `provider.run.failed` events and a failed `provider-run` gate.

## Internal Provider

`hicode-internal` is the only runnable provider in Sprint 3A/3B.

It is not a mock. It submits the prompt to the existing `RuntimeJobQueue`, using the same runtime execution path that the current Electron input box uses.

Since Sprint 3B, the default path is isolated:

- creates a Job with `source: "provider"` and `executor: "hicode-internal"`;
- creates a git worktree or copy sandbox through Worktree Runner;
- enqueues the prompt into Runtime Queue with `metadata.jobCenterId` and `metadata.executionCwd`;
- writes `provider.run.started` and `provider.run.queued` Job events;
- writes a JSON `provider-run` artifact under `~/.vibe/providers/runs`;
- returns a queued `ProviderRunResult` with logs, Job id, runtime metadata, and current diff changed-file hints.

Runtime Queue state mirroring continues to update the Job status as the existing runtime starts, succeeds, fails, or is cancelled.

Direct mode is not the default and requires both `executionMode: "direct"` and `allowDirect: true`.

## Reserved Providers

Sprint 3A registers these providers as reserved adapters only:

- `codex-cli`
- `claude-code`
- `local-model`

They intentionally report `not_configured` until required configuration and a real `run` implementation both exist. Sprint 3A does not execute Codex CLI, Claude Code, or a local model endpoint. If configured before an implementation lands, they still must not pretend to run; the registry keeps them out of `enabled` status and the service rejects non-implemented execution.

## IPC API

Provider IPC is registered through `registerProviderIpc`:

- `provider:list`
- `provider:get`
- `provider:configure`
- `provider:run`
- `provider:cancel`

All handlers run through the shared IPC registrar, so exceptions become normalized `{ ok: false, error }` responses. Preload exposes only narrow methods:

- `listProviders()`
- `getProvider(providerId)`
- `configureProvider(providerId, payload)`
- `runProvider(providerId, payload)`
- `cancelProvider(providerId, payload)`

## Adding A Provider

1. Add a provider implementation that satisfies `AgentProvider`.
2. Define capabilities honestly.
3. Define `configSchema` and `requiredConfig`.
4. Implement `validateConfig` for non-trivial checks.
5. Implement `run` so every run creates or attaches a Job.
6. Write provider logs as `JobEvent`.
7. Write produced files or run manifests as `ProviderArtifact` and Job artifacts.
8. On failure, write a failed gate result and a normalized `ProviderError`.
9. Add tests for registry behavior, disabled state, missing config, Job integration, and failure recording.

## Safety Boundaries

- Provider cwd must remain inside the current workspace.
- Provider artifacts must stay inside workspace or app data roots allowed by JobStore.
- Provider config is stored in app data with private file permissions and is not exposed back to renderer.
- External CLI providers are placeholders only in Sprint 3A.
- Provider logs should not contain raw secrets; main-process logging still passes through redaction.
