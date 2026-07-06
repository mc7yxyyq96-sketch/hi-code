# PLC / OpenPLC Adapter

Sprint 6D adds the PLC automation adapter for IEC 61131-3 Structured Text engineering drafts. It supports OpenPLC/MATIEC detection, I/O map generation, Structured Text scaffold generation, compile planning, FAT/SAT checklist generation, and safety review gates.

This adapter does not download logic to PLC hardware. It does not claim a PLC program has been compiled unless a local compiler command actually runs and returns success.

## Supported Scope

- Detect `iec2c`, `iec2iec`, `openplc`, or `openplc_editor`.
- Accept a user-configured executable path.
- Generate Structured Text engineering draft files.
- Generate I/O map CSV files.
- Generate safety interlock documentation.
- Generate FAT and SAT checklists.
- Generate compile plan artifacts when no compiler is available.
- Attempt a local IEC syntax check only when a compiler command is detected and the user explicitly approves execution.

Device download, online forcing, fieldbus control, runtime start/stop, and unsafe default control sequences are out of scope for Sprint 6D.

## Safety Boundary

Every generated PLC output carries these assumptions:

- Human approval is required before compile, simulation, FAT, SAT, commissioning, or device download.
- Outputs are forced to fail-safe values in the generated draft.
- Emergency stop and safety interlocks must be reviewed by qualified personnel.
- Dry-run compile gates are recorded as `not_run`/skipped, not passed.
- No network or device access is allowed by this adapter.

## Input Schema

Tool runs accept `plcRequest`:

```json
{
  "controllerType": "openplc-compatible-soft-plc",
  "targetRuntime": "openplc",
  "scanCycleRequirement": "100ms nominal scan cycle",
  "controlLogicDescription": "Generate a fail-safe pump permissive draft.",
  "safetyInterlocks": [
    "Emergency stop healthy input must be true before any output is considered.",
    "Manual safety engineer approval required before commissioning."
  ],
  "ioPoints": [
    {
      "tag": "E_STOP_NC",
      "address": "%IX0.0",
      "direction": "input",
      "signalType": "bool",
      "description": "Normally closed emergency stop healthy signal"
    },
    {
      "tag": "PUMP_RUN_CMD",
      "address": "%QX0.0",
      "direction": "output",
      "signalType": "bool",
      "description": "Pump command forced false in draft"
    }
  ],
  "outputDir": ".hicode/artifacts/plc/pump-draft"
}
```

All paths must resolve inside the workspace. `outputDir` must be under `.hicode/artifacts`.

## Output Artifacts

The adapter writes real engineering draft artifacts:

```text
plc-program.st
io-map.csv
safety-interlocks.md
fat-checklist.md
sat-checklist.md
metadata.json
```

When compile is not run, it also writes dry-run compile artifacts:

```text
plc-compile-plan.md
command-preview.sh
expected-artifacts.json
```

`metadata.json` records:

- `compileStatus`: `not_run`, `passed`, or `failed`
- controller and runtime fields
- I/O point count
- emergency stop presence
- `humanApprovalRequired: true`
- `deviceDownloadPerformed: false`
- detection/version evidence

## FAT/SAT Checklist

The generated FAT checklist covers:

- I/O map verification against electrical drawings
- emergency stop and safety interlock verification
- fail-safe startup behavior
- control narrative review
- compiler/tool evidence
- approval before SAT

The generated SAT checklist covers:

- lockout/tagout and permit-to-work conditions
- field I/O verification
- emergency stop testing before normal sequence checks
- approved commissioning steps only
- deviation recording and stop conditions
- final approval before release

## Quality Gates

The adapter records diagnostics and Job Center gates for:

- I/O tag/address/direction completeness
- duplicate point rejection
- safety interlock presence
- emergency stop requirement presence
- human approval required
- compile status

If OpenPLC/MATIEC is missing, compile status is `not_run`. That gate is skipped/not-run and must not be used as release evidence.

## UI Use

1. Open the Toolchain panel.
2. Select `OpenPLC / IEC 61131-3`.
3. Optionally enter an `iec2c` or OpenPLC executable path.
4. Edit controller/runtime, safety interlocks, and I/O points.
5. Click `Generate PLC draft` to write engineering artifacts and compile plan.
6. Click `Run IEC syntax check` only when a local compiler is installed and human approval has been given.

The adapter never performs device download in Sprint 6D.
