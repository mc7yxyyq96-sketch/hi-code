# Domain Packs

Sprint 5A adds a versioned Domain Pack system for industrial engineering knowledge. A Domain Pack packages standards, templates, checklists, tool requirements, quality gates, agent profiles, and sample project references. Sprint 6A can read tool requirements for adapter detection and dry-run planning, but Domain Packs still do not execute CAD, PLC, PCB, BIM, process, or energy tools directly.

## Pack Structure

Installed packs live under the application data safe root:

```text
~/.vibe/domain-packs/
  domain-packs.json
  installed/<pack-id>/
    hicode.domain.json
    templates/*.md
    checklists/*.md
```

The core model and manager live in `src/domain-packs.ts`. Electron integration lives in `electron/services/domain-pack-service.mjs`. Renderer UI lives in `renderer/components/domain-pack-panel.js` and is shown inside the Industrial Project page.

## Manifest Schema

Each pack must contain `hicode.domain.json` with these fields:

```json
{
  "id": "pcb-eda",
  "name": "PCB EDA",
  "version": "1.0.0",
  "domains": ["pcb", "electrical", "qa"],
  "description": "PCB schematic, layout, Gerber, BOM, ERC, DRC, and release workflow.",
  "standards": [],
  "templates": [],
  "checklists": [],
  "toolRequirements": [],
  "qualityGates": [],
  "agentProfiles": [],
  "sampleProjects": [],
  "sha256": "optional 64-char hex hash",
  "signature": "optional detached signature",
  "signatureAlgorithm": "optional signature algorithm"
}
```

Nested model names:

- `DomainPack`
- `DomainPackManifest`
- `DomainStandard`
- `DomainTemplate`
- `DomainChecklist`
- `DomainToolRequirement`
- `DomainQualityGate`
- `DomainAgentProfile`

## Manager API

`DomainPackManager` supports:

- `listDomainPacks`
- `getDomainPack`
- `installDomainPack`
- `enableDomainPack`
- `disableDomainPack`
- `validateDomainPack`
- `updateDomainPack`
- `uninstallDomainPack`
- `recommendForDomains`

Electron IPC exposes:

- `domain-pack:list`
- `domain-pack:get`
- `domain-pack:validate`
- `domain-pack:install`
- `domain-pack:update`
- `domain-pack:enable`
- `domain-pack:disable`
- `domain-pack:uninstall`
- `domain-pack:recommend`

## Security Restrictions

- Pack install paths are confined to `~/.vibe/domain-packs`.
- Template and checklist paths must be relative packaged paths.
- Absolute paths, `..`, `~`, `file:`, Windows drive paths, and root paths are rejected.
- Remote pack `sourceUrl` must use HTTPS.
- Remote packs may not define `sourcePath`, `sourceRoot`, `localPath`, or `filePath`.
- Remote packs require `sha256` or `signature` unless the caller explicitly passes an unverified install override.
- Manifest fields such as `scripts`, `postinstall`, `installCommand`, `command`, `commands`, `exec`, and `args` are rejected.
- `toolRequirements` are descriptive only. They cannot define executable commands or scripts.
- Domain Packs never auto-run external tools. Tool calls must go through the Industrial Tool Adapter service, explicit user approval, and the existing permission system.

## Industrial Project Integration

When a pack is enabled for a workspace with `.hicode/project.json`, Hi Code:

- Adds pack standards to `project.standards`.
- Adds pack quality gates as `pending` gates with `metadata.domainPackId`.
- Stores templates and checklists in `project.metadata.domainPacks`.
- Records a project event such as `domain-pack.enabled`.
- Records a Job Center job/event/artifact for the pack operation.

Disabling a pack updates `project.metadata.domainPacks.enabled` and records an audit event. It does not delete historical project evidence.

## Agent Team Integration

Sprint 5B uses enabled Domain Packs when generating professional Agent Team plans:

- Pack `agentProfiles` become `domain-pack-reviewer` profiles.
- Pack templates contribute artifact plan entries.
- Pack checklists contribute review/checklist plan entries.
- Pack quality gates contribute Agent Team quality gates.
- Pack tool requirements contribute dry-run-only tool-run plan entries.

Disabled packs do not participate in Agent Team planning.

## Industrial Tool Adapter Integration

Sprint 6A surfaces enabled pack `toolRequirements` in the Toolchain panel next to adapter detection results. A requirement such as `EDA tool` can recommend KiCad or another EDA adapter, but the pack cannot provide executable arguments or scripts. Dry-run artifacts and diagnostics are produced by `src/industrial-tool-adapters.ts` and recorded in Job Center.

## Built-In Packs

Sprint 5A includes these built-in manifests:

- `software-product`
- `mechanical-cad`
- `solidworks`
- `pcb-eda`
- `plc-automation`
- `bim-architecture`
- `process-chemical`
- `energy-electrical`
- `materials-engineering`
- `manufacturing-qa`

Each built-in pack includes real manifest data, Markdown templates, checklists, tool requirement metadata, quality gate definitions, and a domain reviewer profile. External industrial tools are marked as requirements only; no adapter execution is implemented in Sprint 5A.

## Adding A Pack

1. Create a manifest that validates with `validateDomainPackManifest`.
2. Use known Industrial Project domains and gate types.
3. Put template/checklist content directly in the manifest.
4. Keep paths relative to the pack root.
5. Do not include scripts, commands, or local path references.
6. Add tests for manifest validation, install, enable/disable, and project association.

## Validation

```bash
npm run build
npm run verify
node test/domain-pack-tests.mjs
node test/agent-team-tests.mjs
node test/industrial-tool-tests.mjs
node test/feature-tests.mjs
```
