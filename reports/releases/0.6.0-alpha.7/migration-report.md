# Hi Code 0.6.0-alpha.7 Migration Report

## Scope

This candidate adds protocol-native assistant output to the existing v0.6 runtime migration. It does not move, rewrite, or delete user projects, configuration, sessions, Job Center records, industrial project files, or release packages.

## Compatibility

- Existing Electron IPC channel names remain unchanged.
- Existing runtime event fields remain readable while each materialized event also carries the versioned runtime protocol envelope.
- Existing saved session JSON remains the authoritative full-context resume source for this release.
- Existing runtime JSONL remains append-only. New `assistant.delta` and `assistant.completed` records are additive.
- The legacy runtime event callback remains available during migration.
- The legacy Electron stdout bridge remains an opt-out compatibility path for command and tool console text, not assistant content.

## Data Migration

No destructive data migration is run. Event-only context reconstruction is deferred to HC-RUN-202 and cannot be claimed by this candidate.

## Rollback

Revert the alpha.7 release integration commit and the three HC-RUN-201 commits in reverse order. Existing session and JSONL files remain on disk and readable by the compatibility path. No rollback step deletes user data.
