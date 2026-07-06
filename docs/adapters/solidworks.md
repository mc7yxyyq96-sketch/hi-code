# SolidWorks Adapter

Sprint 6F adds the SolidWorks bridge foundation for Hi Code. SolidWorks is commercial Windows software that typically requires a licensed local installation, COM/API access, company CAD templates, and user-controlled macro execution. This adapter therefore only detects local evidence, generates a bridge package, and records dry-run artifacts. It does not launch SolidWorks or claim native CAD files were generated.

## Supported Boundary

- Detect Windows support status.
- Detect common `SLDWORKS.exe` install paths.
- Detect `SOLIDWORKS_HOME`, `SOLIDWORKS_EXE`, or `SOLIDWORKS_COM_BRIDGE`.
- Accept a user-configured executable path.
- Return `unsupported_platform` on non-Windows platforms.
- Generate bridge documentation, input/output schemas, macro template, and manual setup instructions.
- Mark native SolidWorks outputs as `external_required`.

Real COM/API execution, automatic part creation, assembly generation, drawing export, STEP export, and BOM export are not performed by Hi Code in Sprint 6F.

## Windows / COM / API Notes

SolidWorks automation normally happens through a Windows COM session owned by the licensed desktop user. Hi Code must not bypass licensing or start hidden commercial software sessions. A future production bridge should run as a user-installed local bridge with:

- explicit human approval per run
- visible SolidWorks session or approved service account policy
- company macro/security policy review
- project-confined output paths
- audited command and artifact records
- clear handling of SolidWorks API version differences

## Capabilities

The adapter declares:

- `part_generation_bridge`
- `assembly_generation_bridge`
- `drawing_export_bridge`
- `step_export_bridge`
- `bom_export_bridge`
- `macro_generation`
- `external_execution_required`

Capabilities ending in `_bridge` require an installed and licensed SolidWorks environment before any future external execution can be considered.

## Input Schema

Dry-run accepts `solidworksRequest`:

```json
{
  "bridgeType": "part",
  "partName": "hicode-bridge-control-box",
  "dimensions": {
    "length": 120,
    "width": 80,
    "height": 36,
    "wallThickness": 3
  },
  "material": "ABS",
  "units": "mm",
  "expectedOutputs": ["SLDPRT", "STEP", "BOM"],
  "outputDir": ".hicode/artifacts/solidworks/bridge-package",
  "bridgeScriptType": "vba"
}
```

All paths must resolve inside the workspace. `outputDir` must stay under `.hicode/artifacts`.

## Dry-Run Artifacts

The adapter writes:

```text
solidworks-run-plan.md
solidworks-bridge-plan.md
macro-template.bas
solidworks-input-schema.json
solidworks-output-schema.json
expected-artifacts.json
manual-setup.md
metadata.json
```

Generated bridge files are marked:

```json
{
  "generated": true,
  "simulated": true,
  "external_required": true
}
```

Expected native SolidWorks outputs are marked:

```json
{
  "generated": false,
  "simulated": false,
  "external_required": true
}
```

This makes the difference explicit: Hi Code generated bridge evidence, not `.sldprt`, `.sldasm`, or `.slddrw` files.

## Bridge Macro Template

`macro-template.bas` is a user-reviewed VBA macro starter for a licensed Windows SolidWorks session. It embeds the request dimensions and output directory and displays the package information to the engineer. It is not executed by Hi Code.

Before any future real bridge execution, the macro or bridge script must be reviewed for:

- company CAD standards
- material library references
- template/document paths
- output file naming
- engineering approval workflow
- security policy compliance

## Quality Gates

The adapter records diagnostics and Job Center gates for:

- platform check
- installation check
- explicit authorization requirement
- dimension validation
- expected output existence status

When execution has not happened, gate status is `not_run` or simulated/skipped. Dry-run gates must not be treated as release evidence for native CAD outputs.

## Manual Authorization

All SolidWorks bridge execution requires a human approval record. Approval must confirm:

- the workstation has a valid licensed SolidWorks installation
- the engineer reviewed the generated macro
- output paths are project-approved
- the run is allowed by company CAD/security policy
- generated native files will be attached back into Hi Code as external artifacts

## Future Real Integration Route

Recommended next steps for production integration:

1. Build a signed Windows bridge runner that executes only reviewed scripts.
2. Add COM/API version detection through a user-launched SolidWorks session.
3. Add a secure bridge protocol with request/response JSON and artifact hashing.
4. Add template/material/profile configuration per company or Domain Pack.
5. Add real artifact validation for `.sldprt`, `.sldasm`, `.slddrw`, STEP, and BOM files.
6. Add approval and rollback records in Job Center before merge/release gates.
