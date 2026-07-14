# Cross-Platform Execution Policy

Hi Code evaluates every managed child-process launch against one versioned policy contract before spawning it. The contract covers executable/argument bounds, canonical working directory and roots, filesystem intent, network intent, child environment, approval, timeout, captured output, audit metadata, and descendant cleanup.

## Capability Truth

The Settings **Permissions & Security** page reads a diagnostics-only IPC endpoint. The renderer cannot submit commands, environment values, roots, or policy overrides through that endpoint.

| Platform | Reviewed backend | Filesystem | Network deny | Process tree | Reported strength |
| --- | --- | --- | --- | --- | --- |
| macOS | `sandbox-exec` when its local probe passes | approved roots can be write-confined; host reads remain visible | supported for non-interactive managed children | detached process group | `partial` |
| Linux | bubblewrap when its executable and user-namespace probe pass | host mounted read-only with approved writable binds | private network namespace | `--die-with-parent` plus process group | `partial` |
| Windows | no restricted-token backend is claimed yet | no OS write confinement | unavailable | bounded `taskkill /T /F` cleanup | `weak` |

No backend is reported as `strong`. A missing backend is `weak`, not silently equivalent to sandboxing. WSL2, containers, virtual machines, or managed workers remain the recommended boundary for untrusted execution on unsupported hosts.

## Enforcement Modes

- `strict`: deny the launch if a requested filesystem, network, or process-tree control is unavailable.
- `report-only`: retain existing explicitly approved behavior, but return `weak` with the missing control in warnings and evidence.

Runtime Bash uses strict workspace isolation when configured to sandbox. Existing isolated worktree, Patch Arena gate, and authorized industrial-tool paths use report-only mode so cross-platform behavior remains compatible while evidence stays truthful.

## Managed Runners

- `runManagedExecution()` owns an asynchronous child, enforces timeout/output bounds, and terminates its process group or Windows tree.
- `runManagedExecutionSync()` preserves synchronous adapter APIs by delegating to `execution-supervisor`, which owns and cleans the target tree rather than relying on `spawnSync` to kill only the direct child.
- Both runners return metadata-only policy evidence. Arguments and environment values are deliberately absent.

When the host is Electron, only the internal synchronous supervisor receives `ELECTRON_RUN_AS_NODE=1`. It still receives the minimal safe environment and never inherits model keys, tokens, cookies, or credentials. This prevents a Node supervisor from launching a second desktop application while keeping the exception narrow and auditable.

The managed paths are Runtime Bash, integrated terminal startup, Quality Gate command gates, Worktree Runner commands, Patch Arena quality commands, MCP stdio servers, and FreeCAD/KiCad/OpenPLC/IfcOpenShell detection or execution.

## Environment And Approval

`buildSafeChildEnv()` is the only default environment constructor. Parent API keys, tokens, passwords, cloud credentials, package tokens, cookies, and `SSH_AUTH_SOCK` are excluded. Explicit MCP server environment entries remain allowed because they are user configuration, but only environment key names enter policy audit metadata.

Renderer booleans are not authorization. Worktree commands, custom command gates, and real industrial adapter execution request a main-process permission decision. Dry-run and side-effect-free detection do not prompt and cannot be promoted to real execution evidence.

## Audit Shape

An execution audit records:

- request/surface identifiers
- platform, backend, and isolation strength
- executable basename and argument count
- root count and requested filesystem/network policy
- environment key names only
- timeout/output bounds
- approval and process-tree requirements

It never records argument values, environment values, complete commands, or captured output. Product-specific evidence may contain bounded/redacted tool output where required by a quality gate, but that is separate from the policy audit.

## Verification

```bash
npm run build
npm run test:execution-policy
npm run test:terminal
npm run test:worktree
npm run test:quality-gates
npm run test:industrial-tools
npm run test:security
npm run test:electron-e2e
npm run verify
```

The execution-policy suite uses deterministic platform fixtures and real POSIX descendant processes. Windows behavior is contract-tested with the exact bounded `taskkill` invocation and remains covered by the Windows Electron CI job.
