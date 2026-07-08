# Hi Code v0.5.2 GitHub Release Draft

## Title

Hi Code v0.5.2 - desktop stability, Store lifecycle, usage stats, and release packaging

## Summary

v0.5.2 is a stabilization release for the early open-source desktop build. It focuses on making the app easier to try, verify, package, and continue developing across Codex, Claude Code, and Cursor.

This version is still an early preview. The core local agent loop, desktop workbench, Store lifecycle, MCP support, Job Center, Patch Arena, industrial project foundation, and release checks are present, but the UI and industrial workflow depth will continue to evolve.

## Highlights

- Added local usage statistics persistence and a Settings usage dashboard.
- Fixed desktop command flow issues around slash-command handling and native app opening.
- Improved Store lifecycle visibility for installed Plugin, Skill, Agent, and MCP entries.
- Added enable, disable, uninstall, and read-only states for managed capability entries.
- Improved Chinese Store detail summaries without pretending local summaries are online translation.
- Tightened responsive desktop layouts for settings, Git, Job Center, industrial workbench, Domain Pack, Agent Team, Toolchain, and Quality Gate panels.
- Added renderer regression tests for modal clipping, settings overflow, capability lifecycle states, sidebar collapse, and workbench breakpoints.
- Added package metadata and `npm run release:checksums` for repeatable release checksum generation.

## Downloads

Attach these files from the local `release/` directory:

- `Hi Code-0.5.2-arm64.dmg`
- `Hi Code-0.5.2-win.zip`
- `Hi Code-Setup-0.5.2-win-x64.exe`
- `SHA256SUMS-v0.5.2.txt`

## SHA256

```text
7b66d2a6c4a00776f1d2c760be432bd265c1d3a594e63680785eee3fe45333c5  release/Hi Code-0.5.2-arm64.dmg
aa76fd189fceec21fbac38df6b1cbc232247435abbd7255ab9385aa0ef4df423  release/Hi Code-0.5.2-win.zip
3ad9d74890a4a9b11adf403cf80b48186dc7a7c3b744232603d0598a51ef9045  release/Hi Code-Setup-0.5.2-win-x64.exe
```

## Verification

Last local verification on 2026-07-07:

- `npm run build`: passed
- `npm run verify`: passed
- `npm run release:check`: passed
- `node test/feature-tests.mjs`: 75 passed / 0 failed
- `npm run test:security`: passed
- `npm run scan:dod`: 0 findings
- `npm run dist:mac`: passed
- `npm run dist:win`: passed
- `npm run release:checksums`: passed

## Known Limitations

- macOS DMG is not signed yet. On first launch, right-click the app and choose Open.
- Windows installer is not signed yet and may trigger SmartScreen.
- External industrial tools such as FreeCAD, KiCad, OpenPLC, IfcOpenShell, SolidWorks, and AVEVA are detected safely. Missing tools use dry-run or bridge-plan behavior and do not pretend to execute real commercial integrations.
- Real Codex CLI / Claude Code CLI provider integration is reserved for a later version. Current external provider entries must not be described as fully integrated.

## Upgrade Notes

- Existing local config and sessions remain under the user data directory.
- Store-managed capability entries now expose clearer lifecycle state.
- The release checksum file can be regenerated with:

```bash
npm run release:checksums
```

## Suggested Announcement Copy

Hi Code v0.5.2 is now available as an early open-source desktop preview. It is a local-first AI engineering workbench for OpenAI-compatible models, with a real agent loop, MCP support, visual diffs, Git workflow, Store lifecycle, Job Center, Patch Arena, and early industrial project workflows. This release focuses on stability, packaging, UI responsiveness, and verification so more users can safely try the app and give feedback.
