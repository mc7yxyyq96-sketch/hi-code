# Hi Code 0.6.0-alpha.8 Known Limitations

- Safe recovery is explicit and conservative. Hi Code does not reattach to an operating-system process or automatically replay a mutating tool after interruption.
- Older event streams without exact normalized model messages remain replay-only; Hi Code does not invent resumable context from summaries.
- The legacy stdout compatibility bridge can still carry command and tool console text. Assistant model text no longer depends on that bridge.
- External Codex CLI and Claude Code providers remain unconfigured and cannot be advertised as executable integrations.
- The generated macOS alpha package is not signed or notarized. Windows production signing, update channels, SBOM, and provenance remain future release work.
- The three-platform CI result verifies application startup, not every operating-system integration or installer lifecycle.
- SolidWorks and AVEVA remain permission-gated external bridges that require licensed customer environments and manual approval.
- Real FreeCAD, KiCad, PLC, and IFC execution depends on installed tools and explicit authorization; unavailable tools remain clearly marked as dry-run, `simulated`, or `not_run`.
