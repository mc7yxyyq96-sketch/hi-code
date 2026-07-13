# Industrial Tool Adapters

Sprint 6A adds the adapter foundation for industrial engineering tools. It supports real tool detection and safe dry-run planning for FreeCAD, KiCad, PLCopen, OpenPLC, IfcOpenShell, SolidWorks, Altium, Revit, CODESYS, TwinCAT, and AVEVA-related workflows. Sprint 6B promotes FreeCAD into a real execution adapter for a parameterized control box enclosure. Sprint 6C promotes KiCad into the first real PCB adapter for project inspection, ERC/DRC, Gerber/drill planning, and `kicad-cli` execution when installed. Sprint 6D promotes OpenPLC / IEC 61131-3 into the first PLC adapter for Structured Text drafts, I/O maps, FAT/SAT checklists, and compile-status evidence. Sprint 6E promotes IfcOpenShell into the first BIM/IFC adapter for local IFC inspection, element/space statistics, property extraction, and BIM delivery checklists when the Python module is installed. Sprint 6F adds a SolidWorks bridge foundation for Windows COM/API detection, macro template generation, and external-required artifact planning. Sprint 6G adds an AVEVA / industrial engineering software bridge foundation for connector profiles, data exchange schemas, CSV templates, sync risk planning, and enterprise approval gates. Other adapters remain dry-run-only and do not claim deep automation for commercial CAD/EDA/BIM/PLC platforms.

## Interfaces

Core types live in `src/industrial-tool-adapters.ts`:

- `IndustrialToolAdapter`: adapter manifest for one external tool family.
- `ToolCapability`: dry-run or future execution capability with domains, artifact types, and quality gates.
- `ToolDetectionResult`: installed state, evidence, version information, diagnostics, and setup hints.
- `ToolRunRequest`: requested task, mode, workspace, artifact directory, arguments, approval, and network settings.
- `ToolRunResult`: command preview, diagnostics, artifacts, detection result, and failure reason.
- `ToolArtifact`: persisted output metadata. Dry-run artifacts must set `simulated: true`.
- `ToolDiagnostic`: adapter warnings/errors that can be attached to Job Center gate results.
- `ToolVersionInfo`: parsed version command result.

The registry exposes:

- `registerAdapter`
- `listAdapters`
- `detectAdapter`
- `getAdapterCapabilities`
- `runAdapterTask`
- `validateAdapterConfig`

Electron routes these through `electron/services/industrial-tool-service.mjs` and IPC channels:

- `toolchain:list`
- `toolchain:detect`
- `toolchain:capabilities`
- `toolchain:validate-adapter`
- `toolchain:run`

Renderer access goes through `renderer/api/hicode-api.js` and the Toolchain panel in `renderer/components/toolchain-panel.js`.

## Detection

Detection checks the configured evidence without executing project-changing operations:

- command lookup on `PATH`
- version command with `spawnSync` and `shell: false`
- executable path checks
- environment variable markers
- config path checks

When a tool is missing, the adapter must return:

- `installed: false`
- a readable `reason`
- a `setupHint`
- diagnostics that explain the missing capability

Missing tools must never be reported as installed. Commercial tools are detected only through safe local evidence such as configured environment variables or known paths.

## Dry-Run

Dry-run mode is the default safe path for all adapters. Generic dry-run writes a JSON artifact under:

```text
.hicode/generated/tool-adapters/<adapterId>/<adapterId>-dry-run.json
```

The artifact contains:

- adapter id and tool name
- task summary
- `simulated: true`
- installed state
- command preview
- input artifact list
- expected output artifact types
- required approval note
- diagnostics

Dry-run does not call the external tool and does not claim that CAD, PCB, BIM, or process outputs were generated. FreeCAD dry-run writes `freecad-run-plan.md`, `expected-input.json`, and `expected-artifacts.json` under `.hicode/artifacts/freecad/*`. KiCad dry-run writes `kicad-run-plan.md`, `expected-input.json`, `expected-artifacts.json`, and `command-preview.sh` under `.hicode/artifacts/kicad/*`. PLC/OpenPLC dry-run writes real engineering draft artifacts plus `plc-compile-plan.md`, `command-preview.sh`, and `expected-artifacts.json`; compile status remains `not_run` unless a local IEC compiler actually runs. BIM/IFC dry-run writes `ifc-check-plan.md`, `expected-input.json`, `expected-artifacts.json`, `command-preview.sh`, `bim-delivery-checklist.md`, and `metadata.json`; real IFC statistics are only produced when the IfcOpenShell Python module actually runs. SolidWorks dry-run writes `solidworks-run-plan.md`, `solidworks-bridge-plan.md`, `macro-template.bas`, schema files, `expected-artifacts.json`, `manual-setup.md`, and `metadata.json`; native `.sldprt/.sldasm/.slddrw` outputs are marked `external_required`. AVEVA dry-run writes `aveva-integration-plan.md`, `data-exchange-schema.json`, tag/equipment/line/document CSV templates, `sync-risk-checklist.md`, and `metadata.json`; all outputs are marked `simulated`, `external_required`, and `manual_approval_required`.

## FreeCAD Real Execution

FreeCAD requires `FreeCADCmd`/`freecadcmd`, explicit user approval, and workspace-confined output paths. It can generate a simple parameterized control box enclosure and `.FCStd`, with STEP/STL attempted when the local FreeCAD environment supports those exports.

Details are in `docs/adapters/freecad.md`.

## KiCad PCB Execution

KiCad requires `kicad-cli`, explicit user approval, and workspace-confined project/output paths. It validates `.kicad_pro`, schematic, and board paths; can run ERC/DRC; can export Gerber and drill files; can attempt BOM export; and always writes `metadata.json` plus `kicad-cli.log` for traceability. Missing KiCad installations only produce simulated dry-run files and never claim Gerber/BOM generation.

Details are in `docs/adapters/kicad.md`.

## PLC / OpenPLC Execution

OpenPLC / IEC 61131-3 support generates real engineering draft artifacts: `plc-program.st`, `io-map.csv`, `safety-interlocks.md`, `fat-checklist.md`, `sat-checklist.md`, and `metadata.json`. If `iec2c`/MATIEC or OpenPLC compiler tooling is missing, it also writes a compile plan and marks `compileStatus: not_run`. If a compiler command is detected and the user explicitly approves execution, Hi Code may attempt a local syntax check. It never downloads logic to PLC hardware.

Details are in `docs/adapters/plc-openplc.md`.

## BIM / IFC Execution

IfcOpenShell support can inspect IFC/IFCZIP files through the local Python `ifcopenshell` module. With explicit approval it writes `bim-inspection-report.json`, `bim-summary.md`, optional `bim-delivery-checklist.md`, `ifc-inspection.log`, and `metadata.json` under `.hicode/artifacts/bim/*`. CLI-only evidence is not enough for real inspection; missing Python module support remains dry-run-only.

The adapter does not produce local building-code compliance conclusions. It records target-standard notes, checklist items, and human review gates.

Details are in `docs/adapters/bim-ifc.md`.

## SolidWorks Bridge

SolidWorks support in Sprint 6F is a commercial-software bridge package generator. It detects Windows support and common `SLDWORKS.exe` evidence, returns `unsupported_platform` on non-Windows systems, and generates a reviewed bridge package for manual use in a licensed Windows SolidWorks session. Hi Code does not launch SolidWorks or claim native SolidWorks files were generated.

Details are in `docs/adapters/solidworks.md`.

## AVEVA Bridge

AVEVA support in Sprint 6G is an enterprise connector planning package. It validates connection profile shape, rejects plaintext credentials, warns on non-HTTPS endpoints, validates allowed operations, and writes data exchange templates and sync risk checklists. Hi Code does not connect to AVEVA, VPN, project databases, or licensed APIs.

Details are in `docs/adapters/aveva.md`.

## Security

Adapter execution follows these boundaries:

- External tool execution requires explicit user approval.
- Renderer `userApproved` input cannot grant that approval. The main process obtains the permission decision and only then marks the internal adapter request approved.
- Tool detection and real execution use the shared managed execution runner. Detection is read-only; real generation/compile/inspection is workspace-write, network-deny, bounded, and process-tree-managed.
- A platform without an OS filesystem/network backend may preserve an explicitly approved compatible run only as `weak` report-only evidence. It is never labeled strong or fully sandboxed.
- Real execution is blocked for adapters other than FreeCAD, KiCad, OpenPLC/IEC, and IfcOpenShell/IFC in Sprint 6F, even if approval is supplied.
- PLC/OpenPLC artifacts always require human safety approval before compile, simulation, FAT/SAT, commissioning, or device download.
- BIM/IFC inspection never concludes local building-code compliance; qualified human review remains required.
- SolidWorks bridge artifacts require licensed Windows SolidWorks, explicit human authorization, and external manual execution; Hi Code only generates bridge files in Sprint 6F.
- AVEVA connector artifacts require enterprise authorization, approved endpoints, secure credential storage, manual data-owner approval, and an external connector; Hi Code only generates dry-run exchange plans in Sprint 6G.
- Command arguments reject control characters and long unsafe values.
- Workspace and artifact paths are restricted to the current workspace.
- Generated artifacts stay under `.hicode/generated/tool-adapters` unless a safe in-workspace artifact directory is supplied.
- Input artifacts must resolve inside the workspace.
- Logs and detection output redact tokens, secrets, and home-directory paths.
- Adapter networking is forbidden unless a future adapter explicitly supports it and the user authorizes it.
- Domain Pack `toolRequirements` can recommend tools but cannot define commands, scripts, or automatic execution.

## Job Center Integration

Every detection and dry-run creates or updates a Job Center record:

- detection events use `industrial-tool.detected`
- dry-run start events use `industrial-tool.run.started`
- dry-run completion uses `industrial-tool.dry-run.completed`
- generated artifacts are added as Job artifacts
- diagnostics are added as gate results

This keeps industrial tool planning traceable alongside software builds, tests, Patch Arena runs, and Agent Team plans.

## Project And Domain Pack Integration

`IndustrialProject.toolchain` declares project-level tools. Enabled Domain Packs can also declare `toolRequirements`. The Toolchain panel shows both sources next to adapter detection results, so users can see which tools are required before attempting work.

## Adding An Adapter

1. Add an `IndustrialToolAdapter` with domains, detection rules, capabilities, and setup hints.
2. Keep detection side-effect free.
3. Add dry-run expected outputs and quality gates.
4. Add tests for missing detection, dry-run artifact generation, path restrictions, and Job Center events.
5. Document commercial licensing or installation assumptions.

Commercial adapters such as SolidWorks, Altium, Revit, CODESYS, TwinCAT, and AVEVA must not pretend to run real automation until a verified connector exists and the user grants explicit permission.
