# ADR-0020: Unified Provider Control Plane

- Status: Accepted
- Date: 2026-07-13
- Owners: Runtime, Security, Desktop

## Context

Hi Code had two related but different extension surfaces:

1. model transports used by the internal runtime loop; and
2. autonomous Agent executors used by Provider jobs and Patch Arena.

The early Provider registry represented external CLIs as reserved descriptors and did not provide one production contract for health, credentials, privacy, failures, usage, or versioned discovery. Treating a model endpoint and a coding Agent as the same execution primitive would blur tool ownership, workspace isolation, permission, and data-boundary decisions.

Provider configuration can also contain credentials and executable paths. A production design must not serialize raw credentials into Provider JSON, logs, Job events, usage records, or artifacts. External Agents must not receive the main workspace or an unrestricted shell merely because their descriptor is enabled.

## Decision

Hi Code will use a unified Provider control plane while retaining two explicit provider kinds:

- `model`: a model transport invoked by the Hi Code runtime, which owns the agent loop and tools;
- `agent`: an autonomous executor invoked through the Provider service, which owns its own agent loop.

`ProviderControlRegistry` is the versioned control authority for registration, discovery, capabilities, health, enabled state, and descriptor version. It does not erase the execution distinction. Model runs continue through model adapters; Agent runs continue through `AgentProviderRegistry` and Job Center.

Provider descriptors must truthfully report capability, deployment, privacy, credential state, and health. Provider execution failures use one normalized category set and a bounded retry/fallback policy. Usage persistence records only aggregate telemetry.

Credentials are represented by scoped secret references and stored through the OS-backed secret store. Rotation updates the secret plus non-secret lifecycle metadata. Expired credentials are not considered healthy.

External Agent providers must:

- require explicit configuration and authorization;
- run without a shell using an absolute executable and validated argv;
- use isolated worktrees or copy sandboxes by default;
- use the managed minimal child environment;
- support timeout, cancellation, process-tree cleanup, and bounded output;
- record truthful Job events, patches, gates, artifacts, and usage;
- label dry-run output as simulated.

The initial production adapters are OpenAI Responses, Anthropic Messages, OpenAI-compatible Chat Completions, Ollama, Hi Code internal runtime, Codex CLI, Claude Code CLI, and custom Agent Worker.

## Consequences

### Positive

- Renderer and orchestration can discover all providers without confusing models with autonomous Agents.
- Patch Arena can filter to Agent providers while the runtime continues to use model profiles.
- Credential status, privacy, health, capabilities, and usage have one stable shape.
- Failures and retries no longer rely on provider-specific string handling at every caller.
- External CLIs become real, auditable execution paths without weakening workspace isolation.

### Costs

- Existing Provider descriptors require a compatibility projection into the control-plane schema.
- Health probes can add network or process-detection latency and therefore remain user-triggered or explicitly scheduled.
- Cost estimates are only as accurate as configured/provider metadata; unknown values remain unknown.
- Enterprise custom workers require organization-specific policy and executable configuration.

### Security and Privacy

- Provider JSON contains secret references, never credential values.
- Recursive redaction applies before logs, Job events, artifacts, and errors leave the main process.
- Local, remote, and enterprise deployments expose different privacy labels in the UI.
- External Agent execution cannot silently switch to direct mode or inherit an unrestricted environment.

### Compatibility

- Existing `provider:list`, `provider:get`, `provider:configure`, `provider:run`, and `provider:cancel` channels remain available.
- Existing Runtime Queue and Job Center integration remains authoritative for `hicode-internal`.
- Legacy local-model configuration remains visible as a model compatibility descriptor.
- Desktop, CLI, TUI, MCP, and model-provider call paths retain their existing entry points.

## Rejected Alternatives

1. **Use one execution interface for models and Agents.** Rejected because it hides who owns tools, permissions, conversation state, and workspace mutations.
2. **Persist provider API keys in private JSON files.** Rejected because file mode alone does not provide OS credential protection and leaks into backups or artifacts.
3. **Enable external CLIs when found on `PATH`.** Rejected because path discovery is not user authorization and can select an unintended executable.
4. **Run external Agents directly in the active workspace.** Rejected because concurrent Agents and dirty user state require isolation and explicit merge decisions.
5. **Treat simulated, unavailable, or not-configured providers as healthy.** Rejected because it creates fake production readiness.

## Verification

`HC-PROV-301` must provide committed evidence for:

- Provider control registry behavior and versioning;
- Model/Agent classification and discovery;
- credential reference, rotation, expiry, and redaction;
- failure normalization, retry, and fallback;
- aggregate usage persistence;
- isolated external Agent execution, cancellation, authorization, artifacts, and Job evidence;
- Provider Settings rendering and IPC validation;
- build, verify, release check, Provider tests, Security tests, feature tests, and DoD scan.
