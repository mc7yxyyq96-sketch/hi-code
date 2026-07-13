# Hi Code 0.6.0 Stable Release Gate

- Decision: **BLOCKED**
- Engineering status: **PASSED**
- Evaluated source: `eaa9f27f312a90c76548c7ad3f04ad1bef65d6ea` on `codex/security-release/0.6.0-stable-gate`
- Evaluated package version: `0.6.0-alpha.8`
- Formal Release created: **No**
- Tag created: **No**

## Conditions

| Gate | Status | Requirement | Evidence result |
| --- | --- | --- | --- |
| runtime-protocol-authority | PASSED | Runtime Protocol v2 is the durable source of truth | Verified by committed evidence. |
| complete-turn-replay | PASSED | Complete turns replay and interrupted turns recover conservatively | Verified by committed evidence. |
| runtime-client-isolation | PASSED | Desktop, CLI, and TUI do not depend on a global stdout bridge | Verified by committed evidence. |
| three-platform-electron-smoke | PASSED | Core Electron startup passes on Linux, macOS, and Windows | Verified by committed evidence. |
| three-platform-package-smoke | PASSED | Native package lifecycle smoke passes on Linux, macOS, and Windows | Verified by committed evidence. |
| code-studio-core-flow | PASSED | Code Studio editor, terminal, preview, and Git delivery flow is evidenced | Verified by committed evidence. |
| mcp-connection-layer | PASSED | MCP stdio and Streamable HTTP lifecycle is compatible and secured | Verified by committed evidence. |
| full-tree-dod | PASSED | Latest full-tree DoD and Skeleton scan has no blocking findings | Verified by committed evidence. |
| p0-p1-release-work | PASSED | No open P0 or P1 release work remains | Verified by committed evidence. |
| truthful-documentation | PASSED | Documentation states the current unsigned and update-disabled boundary | Verified by committed evidence. |
| signed-release-chain | BLOCKED | macOS and Windows signing, Apple notarization, and stable update chain are verified | RISK-REL-001 remains open and current CI artifacts are explicitly unsigned and update-disabled. |
| release-risk-disposition | BLOCKED | No open critical or high non-industrial release risk remains | Open release risks require disposition: RISK-PROV-001. |

## Blockers

- **RISK-REL-001** (medium): Apple signing/notarization and Windows code-signing evidence are not available for stable promotion.
- **RISK-PROV-001** (high): Model transport lacks an explicit capability contract

## Decision

The engineering baseline is retained, but stable promotion is not authorized while the blockers above remain. The package version, formal Release, tag, signing claims, and risk states are unchanged.
