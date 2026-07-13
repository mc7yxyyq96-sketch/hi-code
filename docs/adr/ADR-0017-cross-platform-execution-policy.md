# ADR-0017: Truthful Cross-Platform Execution Policy

Status: Accepted

Date: 2026-07-12

## Context

Hi Code already had permission gates, path confinement, minimal child environments, macOS Bash sandboxing, and terminal process-tree cleanup. These controls were implemented independently, so one launch could not state which filesystem, network, timeout, output, approval, audit, and descendant controls were actually enforced. A macOS-only checkbox also risked overstating protection on Linux and Windows.

## Decision

1. Use `src/execution-policy.ts` as the versioned policy and capability authority.
2. Probe macOS `sandbox-exec` and Linux bubblewrap before claiming them. Do not claim a Windows restricted-token backend until a reviewed implementation exists.
3. Report macOS and Linux backends as partial because host reads remain visible. Report unsupported hosts as weak.
4. Use strict mode for controls that must fail closed and report-only mode only when preserving an already approved compatible path, with warnings in durable evidence.
5. Use `src/execution-runner.ts` for bounded asynchronous launches and a dedicated supervisor for synchronous APIs so timeouts terminate descendants.
6. Keep environment construction in `src/process-env.ts`; policy audit records key names but never values or arguments.
7. Require main-process authorization for renderer-requested worktree commands, command gates, and real industrial execution.
8. Expose only a read-only, bounded capability projection to preload and renderer settings.

## Consequences

- Runtime Bash, terminal, Quality Gate, Worktree, Patch Arena, MCP, and supported industrial adapters share one vocabulary and evidence shape.
- Windows remains usable for explicitly approved paths but is visibly weak until a restricted-token or managed-worker backend is reviewed.
- `sandbox-exec` and bubblewrap are not described as containers or complete confidentiality boundaries.
- Synchronous adapter compatibility adds one short-lived Node supervisor process per real command.
- Existing dry-run, simulated, not-run, and external-required states remain unchanged.

## Rejected Alternatives

- **Claim sandboxing from platform name alone:** rejected because installed tools, kernel configuration, and user namespaces can differ.
- **Treat approval as isolation:** rejected because consent does not confine OS access.
- **Keep raw `spawnSync` timeout behavior:** rejected because descendants can survive the direct child.
- **Expose policy mutation to the renderer:** rejected because a compromised renderer could weaken the launch boundary.
- **Install bubblewrap or WSL automatically:** rejected because host changes require explicit operator control.

## Rollback

Remove the policy service, runner calls, and diagnostics UI while retaining the pre-existing permission, workspace, safe-environment, and process-cleanup controls. No user-data migration is involved.
