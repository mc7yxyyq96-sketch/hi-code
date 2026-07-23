# PARITY Wave4 — Acceptance

## Shipped

- Evidence pack generator: `node scripts/parity-evidence.mjs` → `reports/parity/latest.json`
- Backlog items G-01/G-02/G-03 marked complete (packaging scripts already present: `dist:mac` / `dist:win`)
- Industrial/store/arena remain demoted to advanced chrome
- Version: **0.7.0-parity.1**

## Build installers (unsigned)

```bash
npm run dist:mac   # macOS DMG
npm run dist:win   # Windows x64
```

Signing/notarization is environment-specific and intentionally not required for this parity milestone.

## Core verification snapshot

- gateway / agent-mode / codemap-memory / automation / assistant-turn / tool-union / renderer-architecture: green
