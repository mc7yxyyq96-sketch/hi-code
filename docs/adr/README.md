# Architecture Decision Records

ADRs record decisions that constrain more than one task, client, store, security boundary, or release. Accepted ADRs are authoritative over informal planning text.

## Status Values

- `Proposed`: review is open; implementation must not depend on the decision yet.
- `Accepted`: the decision is active. Planned implementation may still be incomplete and must be labeled as such.
- `Rejected`: the option was evaluated and declined.
- `Deprecated`: the decision remains historical but must not be used for new work.
- `Superseded`: a later ADR replaces the decision and names the replacement.

## Required Sections

Every ADR contains:

1. Status and date.
2. Context and observed evidence.
3. Decision.
4. Consequences, including security and compatibility.
5. Rejected alternatives.
6. Verification or rollout gates.

The file name is `ADR-NNNN-short-title.md`. Numbers are never reused. An accepted ADR is changed only to correct factual errors or mark it superseded; a materially different decision receives a new ADR.

## Current Index

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-0001](ADR-0001-program-control-and-evidence.md) | Accepted | Versioned program board and committed evidence are the delivery control plane |
| [ADR-0002](ADR-0002-runtime-protocol-authority-migration.md) | Accepted | Runtime Protocol becomes authoritative through an injected sink and staged migration |
| [ADR-0003](ADR-0003-typed-runtime-stores-and-idempotent-replay.md) | Accepted | Typed thread, event, and message stores provide additive, idempotent replay and migration |
