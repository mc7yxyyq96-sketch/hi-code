# BIM / IFC Adapter

Sprint 6E adds the BIM / IFC adapter for Hi Code. It supports IfcOpenShell detection, safe dry-run planning, and real local IFC inspection when the Python `ifcopenshell` module is installed and the user approves execution.

The adapter does not pretend IfcOpenShell is installed. Missing installations return `installed: false` and can only produce simulated dry-run artifacts. It also does not conclude compliance with local building codes; it produces inspection evidence, checklists, and human review items.

## Supported Scope

- Detect a Python executable that can import `ifcopenshell`.
- Detect common `python3`/`python` commands and user-configured Python paths.
- Detect IfcOpenShell-related CLI evidence such as `ifcopenshell` or `IfcConvert`.
- Read an IFC/IFCZIP file when the Python module is available.
- Count IFC products and spaces.
- Extract basic element type counts.
- Extract sampled property sets when requested.
- Generate BIM inspection reports and delivery checklists.
- Generate dry-run planning artifacts when the tool is missing or dry-run is requested.

Clash detection, model repair, authoring-tool automation, and building-code compliance decisions are out of scope for Sprint 6E.

## Detection

Detection checks:

- manual `executablePath` supplied by the user
- `IFCOPENSHELL_PYTHON` or Python-related environment evidence
- common Python commands on `PATH`
- common IfcOpenShell and IfcConvert CLI paths
- Python version and module import probe

Automatic detection probes one highest-priority Python interpreter: an explicit `IFCOPENSHELL_PYTHON` executable, then `python3`/`python` on `PATH`, then the first executable common-path candidate. The remaining candidates stay visible as detection evidence but are not launched serially. A user-configured executable path always overrides this bounded automatic probe and is checked directly.

Manual configuration example:

```json
{
  "executablePath": "/usr/local/bin/python3"
}
```

CLI-only evidence can show that an IfcOpenShell tool is present, but real inspection requires the Python module because the adapter reads the IFC model through Python.

## Capabilities

The adapter declares:

- `ifc_inspection`
- `element_count`
- `space_count`
- `property_extract`
- `clash_check_plan`
- `code_check_checklist`
- `bim_delivery_checklist`

## Input Schema

Tool runs accept `bimRequest`:

```json
{
  "ifcPath": "models/building.ifc",
  "outputDir": ".hicode/artifacts/bim/building-inspection",
  "checkProperties": true,
  "generateDeliveryChecklist": true,
  "targetStandard": "ISO 19650 delivery checklist"
}
```

All paths must resolve inside the workspace. `outputDir` must stay under `.hicode/artifacts`.

## IFC Inspection

Python/CLI probes and real inspection are launched through the shared execution-policy runner. Child environments are minimized, network access is denied, output and runtime are bounded, and descendants are terminated as one managed process tree. On Electron, the internal sync supervisor runs explicitly in Node mode so detection cannot stall by launching another desktop process.

Real execution requires:

- Python with `ifcopenshell` installed
- explicit user approval
- no adapter network access
- safe workspace-confined IFC path
- safe `.hicode/artifacts/*` output directory

When those conditions are met, the adapter writes:

```text
bim-inspection-report.json
bim-summary.md
bim-delivery-checklist.md
ifc-inspection.log
metadata.json
```

`bim-inspection-report.json` includes element counts, space counts, type counts, sampled property data, warnings, and `complianceConclusion: null`.

## Dry-Run Behavior

When IfcOpenShell is missing, or when the user chooses dry-run, the adapter writes:

```text
ifc-check-plan.md
expected-input.json
expected-artifacts.json
command-preview.sh
bim-delivery-checklist.md
metadata.json
```

These files are marked `simulated: true`. No IFC model is parsed, no clash or code check is claimed, and the quality gate status is simulated/skipped rather than passed.

## Quality Gates

The adapter records diagnostics and Job Center gates for:

- IFC path confinement
- IFC file existence
- target standard declaration
- real inspection completion
- property extraction warnings
- delivery checklist generation

When the target standard is missing, the gate is a warning so the project has a visible human follow-up. When real inspection is not run, BIM gates are simulated and cannot be used as release evidence.

## Regulatory Boundary

The adapter can prepare code-check checklists, target-standard notes, and delivery review items. It cannot determine whether a building complies with local regulations, permits, fire/life-safety rules, accessibility rules, zoning requirements, or jurisdiction-specific energy codes. Those decisions remain human approval gates handled by qualified reviewers.

## UI Flow

1. Open the Toolchain panel.
2. Select `IfcOpenShell / IFC`.
3. Optionally enter a Python executable path.
4. Enter an IFC file path and target standard.
5. Click `Run dry-run` to generate a plan and command preview.
6. Click `Run IFC inspection` only when the Python module is installed and the user approves local execution.

If IfcOpenShell is not installed, real execution returns a not-installed result and dry-run remains available.
