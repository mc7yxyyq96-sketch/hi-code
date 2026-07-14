# FreeCAD Adapter

Sprint 6B implements the first real industrial tool adapter for Hi Code. It supports FreeCAD detection, safe dry-run planning, and a real `FreeCADCmd`/`freecadcmd` execution path for generating a simple parameterized control box enclosure.

This adapter does not run when FreeCAD is missing. Missing installations return `installed: false` and can only produce simulated dry-run artifacts.

## Installation Detection

The adapter checks:

- `FreeCADCmd` on `PATH`
- `freecadcmd` on `PATH`
- common macOS, Linux, Homebrew, and Windows executable paths
- `FREECADCMD_PATH`
- user-supplied manual `executablePath`
- version output from `FreeCADCmd --version` or the detected executable

Manual path example:

```json
{
  "adapterId": "freecad",
  "executablePath": "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd"
}
```

If only config folders exist and no executable is found, Hi Code reports the adapter as not installed.

## Capabilities

The FreeCAD adapter declares:

- `parametric_part_generation`
- `enclosure_generation`
- `step_export`
- `stl_export`
- `basic_geometry_check`
- `drawing_placeholder_plan` (drawing plan)

STEP and STL export are attempted only when the local FreeCAD environment supports the required modules/exporters. `.FCStd` is the required native output for real execution.

## Input Schema

Tool runs accept `cadRequest`:

```json
{
  "partType": "control_box_enclosure",
  "dimensions": {
    "length": 120,
    "width": 80,
    "height": 36,
    "wallThickness": 3,
    "lidThickness": 3,
    "mountHoleDiameter": 4,
    "mountHoleOffset": 12
  },
  "material": "ABS",
  "units": "mm",
  "constraints": [
    "Open-top control box shell",
    "Four bottom mounting holes",
    "Separate lid design plan"
  ],
  "exportFormats": ["FCStd", "STEP", "STL"],
  "outputDir": ".hicode/artifacts/freecad/control-box-demo"
}
```

Validation rejects:

- non-positive dimensions
- enclosure sizes below safe demo limits
- wall thickness that removes the internal cavity
- lid thickness greater than half the height
- oversized or badly placed mounting holes
- units other than `mm`
- output paths outside the workspace

## Real Execution

Every real process is launched by the shared execution-policy runner after fresh main-process approval. It receives a minimized environment, workspace-confined write roots, bounded output and timeout, managed descendant cleanup, and `network: deny`. Result metadata records the truthful platform backend and isolation strength; unsupported operating-system controls remain visibly weak.

Real execution requires:

- FreeCAD installed and detected
- `mode: "execute"`
- `userApproved: true`
- no network access

The adapter writes a generated Python script into the project artifact directory and runs:

```text
FreeCADCmd hicode-freecad-control-box.py freecad-input.json <outputDir>
```

The spawned FreeCAD process receives a minimized child environment from
`buildSafeChildEnv`: only basic runtime variables such as `PATH`, home/temp
directories, locale, and `HICODE_FREECAD_OUTPUT_DIR` are passed. Parent process
secrets such as model API keys, GitHub tokens, cloud credentials, passwords, and
other `*_TOKEN` / `*_SECRET` values are not inherited.

The script creates:

- control box shell
- separate lid design plan
- four mounting holes
- `.FCStd` native document
- optional STEP/STL exports
- `metadata.json`

All outputs remain inside the workspace artifact directory.

## Output Artifacts

Real execution artifacts can include:

- `freecad-input.json`
- `hicode-freecad-control-box.py`
- `freecad-run.log`
- `metadata.json`
- `drawing-plan.md`
- `control-box-enclosure.FCStd`
- `control-box-enclosure.step`
- `control-box-enclosure.stl`

Job Center records artifacts with `simulated: false`, size, sha256, adapter metadata, and diagnostics.

## Quality Gate

The adapter checks:

- CAD dimensions passed validation
- `metadata.json` exists and contains required fields
- `.FCStd` exists and is non-empty
- requested STEP/STL files are non-empty when produced
- missing STEP/STL exports are warnings when the FreeCAD environment lacks support
- drawing plan exists

Gate diagnostics are written to Job Center.

## Dry-Run Behavior

When FreeCAD is missing, or when the user chooses dry-run, the adapter writes:

- `freecad-run-plan.md`
- `expected-input.json`
- `expected-artifacts.json`

These files are marked `simulated: true`. No FreeCAD process is started, and no CAD file is claimed to exist.

## Demo Usage

In the Toolchain panel:

1. Select `FreeCAD`.
2. Optionally enter the `FreeCADCmd` executable path.
3. Click `Detect`.
4. Click `Run dry-run` to produce simulated planning files.
5. Click `Generate control box demo` to run real FreeCAD when installed.

If FreeCAD is not installed, the demo action returns a not-installed error and dry-run remains available.
