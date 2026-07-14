# Provider Architecture

Hi Code uses one control plane for provider discovery, health, capabilities, credentials, failure policy, privacy, and usage. Execution remains split into two deliberately different provider kinds:

| Kind | Purpose | Examples | Execution boundary |
| --- | --- | --- | --- |
| Model Provider | Produces model responses inside the Hi Code runtime loop | OpenAI Responses, Anthropic Messages, OpenAI-compatible Chat Completions, Ollama | The runtime owns tools, conversation state, permissions, and Job events |
| External Agent Provider | Runs an autonomous coding worker with its own agent loop | Hi Code internal runtime, Codex CLI, Claude Code CLI, custom Agent worker | The provider service owns authorization, isolation, process lifecycle, patches, artifacts, and Job events |

`Model Provider` and `External Agent Provider` are not interchangeable. The `provider:run` external-Agent API rejects model profiles; model profiles are selected through Model API settings and are consumed by the runtime.

## Implemented Providers

Model transports are implemented in `src/model-provider.ts` and discovered from active model profiles:

- OpenAI Responses API
- Anthropic Messages API
- OpenAI-compatible Chat Completions
- Ollama native chat API

External Agent implementations are registered by `electron/services/provider-service.mjs`:

- `hicode-internal`: submits work through the existing Runtime Queue and Job Center path.
- `codex-cli`: runs a user-configured local Codex executable.
- `claude-code`: runs a user-configured local Claude Code executable.
- `custom-agent-worker`: runs an explicitly configured enterprise worker executable.

The compatibility descriptor `local-model` redirects configuration toward a local model profile. It is classified as a model provider and cannot be executed as an external Agent.

An external executable is never reported as usable merely because an adapter exists. Until configuration and detection succeed, health is `not_configured` or `unavailable`.

## Control Plane

`ProviderControlRegistry` in `src/provider-control-plane.ts` exposes the production control contract:

- `register()` and `upsert()` register versioned descriptors.
- `discover()` filters by kind, enabled state, health, or capability.
- `queryCapabilities()` returns a normalized capability profile.
- `healthCheck()` runs the adapter probe and normalizes failures.
- `enable()` and `disable()` persist state through the provider callback.
- `version()` exposes schema version, registry revision, and provider count.

Each descriptor includes:

- provider kind and adapter version;
- model name and context length when known;
- vision, tool, streaming, and reasoning support;
- configured or provider-reported cost metadata;
- local, remote, or enterprise deployment;
- `local_only`, `remote_warning`, or `enterprise_policy` privacy level;
- credential state and expiry without returning the secret;
- last health result and normalized failure.

## Credential Lifecycle

Provider credentials use secret references. Secret values are written through the OS-backed secret store and are not stored in `providers.json`, returned over IPC, written to Job artifacts, or included in the usage ledger.

Credential rotation is explicit:

1. Renderer submits a credential value over the narrow preload method.
2. Main process validates the provider and sensitive field.
3. The secret store replaces the referenced value.
4. Provider state persists only `secretRef`, `rotatedAt`, and optional `expiresAt`.
5. Health and credential status become `stored`, `expiring`, or `expired` as appropriate.

Provider configuration migration moves legacy plaintext sensitive values into the secret store. Provider metadata and errors pass through recursive redaction for key, token, secret, password, authorization, and credential fields.

## Failure Policy

`executeWithProviderPolicy()` implements bounded retries and ordered fallback. Provider failures are normalized into:

- `timeout`
- `quota_exceeded`
- `authentication`
- `network`
- `unavailable`
- `cancelled`
- `validation`
- `provider`

Only retriable categories are retried. Attempts, selected provider, final failure, and retry timing are explicit. Authentication and validation failures do not silently fall through as successful runs.

External Agent processes have a bounded timeout and support cancellation. Cancellation terminates the managed process tree and records a failed or cancelled run rather than returning a successful result.

## External Agent Safety

Codex CLI, Claude Code CLI, and custom Agent workers use the following boundary:

- isolated git worktree by default, with copy sandbox fallback;
- direct mode only when the caller explicitly requests and authorizes it;
- absolute configured executable path and argv execution without a shell;
- explicit user authorization before a real process starts;
- minimized child environment from the managed execution service;
- bounded arguments, output, and timeout;
- workspace and artifact path validation;
- patch collection before cleanup;
- failed workspaces preserved for diagnosis when configured by Worktree Runner;
- logs and failures redacted before Job events or artifacts are written.

Dry-run creates a truthful plan with `simulated: true`; it never claims an external Agent executed.

## Usage Tracking

`ProviderUsageStore` writes a private, atomic local ledger containing:

- input, output, and total tokens;
- latency;
- configured cost estimate;
- provider and adapter identity;
- success/failure counts and failure rate.

The ledger does not persist prompts, completions, credentials, or unrestricted environment values. Missing provider token telemetry remains unknown rather than fabricated.

## Privacy Boundary

- Local model profiles are marked `local_only`; their configured endpoint must remain local to keep that classification.
- Remote model profiles display a data-boundary warning because prompts and tool context can leave the machine.
- Enterprise providers use `enterprise_policy`; the organization must configure its endpoint, executable, authentication, and allowed operations.
- External Agent runs can read only their isolated workspace and approved inputs. Provider artifacts contain execution evidence and patches, not credential material.

## IPC and Renderer

Provider IPC is registered through the shared validated registrar:

- `provider:list`
- `provider:discover`
- `provider:get`
- `provider:capabilities`
- `provider:health`
- `provider:registry-version`
- `provider:usage`
- `provider:credential:rotate`
- `provider:configure`
- `provider:run`
- `provider:cancel`

The Provider Settings panel groups Model and Agent providers and shows health, capabilities, credential state, privacy level, deployment, context, cost metadata, usage, and failure rate. Users can probe health and enable or disable a provider. External Agent configuration fields are available only for Agent adapters.

## Adding a Provider

1. Choose exactly one provider kind.
2. Implement the model adapter or external Agent execution contract; do not expose a descriptor without an honest availability state.
3. Register a versioned capability and privacy descriptor.
4. Define configuration validation and secret-reference fields.
5. Implement an active health probe.
6. Normalize timeout, cancellation, auth, quota, network, and unavailable failures.
7. Record usage without prompts or secrets.
8. For Agent providers, require authorization, isolated execution, Job events, artifacts, and patch evidence.
9. Add registry, failure, credential, security, IPC, Renderer, and execution tests.

## Compatibility

The original `AgentProviderRegistry`, provider IPC names, Runtime Queue integration, Job Center artifacts, and Patch Arena selection remain supported. Patch Arena lists only providers with `kind: "agent"`; model profiles continue to power the Hi Code runtime without masquerading as autonomous Agent workers.
