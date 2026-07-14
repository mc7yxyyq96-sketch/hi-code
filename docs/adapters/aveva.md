# AVEVA Adapter

Sprint 6G adds the AVEVA / industrial engineering software bridge foundation for Hi Code. AVEVA deployments are usually enterprise-managed systems with licensed desktop or server products, project databases, VPN/network controls, identity providers, and proprietary APIs. This adapter therefore only creates a safe connector profile model, data exchange schema, dry-run templates, and sync risk checklist. It does not connect to a real AVEVA system.

## Supported Boundary

- Define an AVEVA connection profile without plaintext secrets.
- Detect local connector/profile evidence without opening a live connection.
- Validate allowed operations and project references.
- Warn on non-HTTPS endpoints.
- Generate data exchange schemas and CSV templates.
- Generate a change sync risk checklist.
- Mark every output as `simulated`, `external_required`, and `manual_approval_required`.

Real AVEVA API calls, project database reads/writes, tag sync, equipment sync, document register sync, VPN use, license checkout, and credential handling are out of scope for Sprint 6G.

The current bridge starts no connector process and opens no network connection. Any future connector must enter through the shared execution-policy runner, require fresh main-process approval, reference credentials rather than persist values, and retain `external_required` until real connector evidence is attached.

## Enterprise Authorization

Hi Code must not bypass enterprise authorization. A production AVEVA connector requires:

- approved enterprise endpoint configuration
- user SSO, system keychain, or external secret manager
- license and project access controlled outside Hi Code
- IT/security approval for connector deployment
- data owner approval for import/export scope
- rollback and audit records before any write-back

No customer server address, username, password, token, API key, or VPN detail should be hard-coded in the project.

## Connection Profile

Dry-run accepts `avevaRequest.connectionProfile`:

```json
{
  "profileName": "plant-data-dry-run",
  "systemType": "aveva-engineering",
  "endpoint": "https://enterprise-approved-connector.example",
  "authMode": "system_keychain",
  "projectId": "PROJECT-001",
  "workspaceMapping": {
    "exportRoot": ".hicode/artifacts/aveva",
    "importRoot": ".hicode/artifacts/aveva/inbound"
  },
  "allowedOperations": [
    "engineering_data_exchange_plan",
    "tag_list_import_export_plan",
    "equipment_list_import_export_plan",
    "piping_line_list_plan",
    "document_register_plan",
    "change_sync_plan"
  ],
  "credentialRef": "system-keychain:aveva/profile/plant-data-dry-run"
}
```

The adapter rejects fields such as `password`, `token`, `apiKey`, `secret`, `clientSecret`, `refreshToken`, and `accessToken`. `credentialRef` is only a reference; the secret itself must live in a system security store or approved external connector.

## Data Exchange Schema

The generated `data-exchange-schema.json` describes:

- connection profile policy
- tag list columns
- equipment list columns
- piping line list columns
- document register columns
- result flags for `simulated`, `external_required`, and `manual_approval_required`

Templates are intentionally CSV-first so an engineering data owner can inspect them before any future connector import/export.

## Dry-Run Artifacts

The adapter writes:

```text
aveva-integration-plan.md
data-exchange-schema.json
tag-list-template.csv
equipment-list-template.csv
line-list-template.csv
document-register-template.csv
sync-risk-checklist.md
metadata.json
```

`metadata.json` records:

- `simulated: true`
- `external_required: true`
- `manual_approval_required: true`
- `plaintextCredentialsPersisted: false`
- sanitized profile fields
- requested operations
- sync plan
- generated artifact list

## Quality Gates

The adapter records diagnostics for:

- connection profile validation
- allowed operations validation
- credential non-persistence
- endpoint transport warning
- data field completeness
- manual approval requirement

When no real connector has run, gates are `not_run`, simulated, warning, or skipped. They are not release evidence for a production AVEVA sync.

## Future Connector Route

Recommended route for a production connector:

1. Build a signed enterprise connector process owned by IT/security.
2. Store secrets in OS keychain, vault, or enterprise identity provider.
3. Support read-only discovery before write operations.
4. Add schema mapping profiles per project and Domain Pack.
5. Add pre-sync export snapshots and diff previews.
6. Require human approval and rollback plan before any write-back.
7. Attach connector logs, hashes, and changed data manifests to Job Center.
