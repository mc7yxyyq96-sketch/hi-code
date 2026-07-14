# Hi Code v0.5.2 Development Plan

Date: 2026-07-07
Owner: Hi Code engineering

## Goal

v0.5.2 is a stabilization and open-source alignment release. It should make the current v0.5.1 codebase easier to trust, test, package, and continue across Codex, Claude Code, and Cursor without adding large new product surfaces.

## Source Of Truth

- Active development repository: `work/Hi-Code`
- GitHub remote: `https://github.com/mc7yxyyq96-sketch/hi-code.git`
- Active branch: `main`
- Legacy comparison copy: `work/Hi Code副本`

`work/Hi Code副本` is not the primary development source. It can be used for comparison only unless explicitly promoted.

## Release Themes

1. Code-line alignment
   - Keep the active repository synchronized with GitHub `origin/main`.
   - Avoid parallel edits in stale local copies.
   - Document any local-only work before publishing.

2. High-impact desktop bug fixes
   - Desktop `/exit` must not hard-kill the Electron process.
   - Native "open app" shortcuts must not swallow normal coding requests such as `运行测试`.
   - Diff state copy must explain that edits are already applied and can be rolled back.
   - Tool banners should stay in the timeline instead of polluting assistant text where practical.

3. Store and capability lifecycle polish
   - Installed items must appear in the matching Plugin, Skill, Agent, or MCP list.
   - Installed mutable items need visible enable, disable, and uninstall actions.
   - Built-in read-only items must say why they cannot be disabled or removed.
   - Store detail summaries should provide clear Chinese descriptions instead of fake translation.

4. UI stabilization
   - Sidebar advanced entries remain collapsible.
   - Settings pages must fit small windows and avoid top clipping or horizontal overflow.
   - Git, Store, Settings, and Industrial Project panels need responsive layout checks.
   - README needs real screenshots before a public-facing release.

5. Verification hardening
   - `npm run verify` must run every core test that guards shipped behavior.
   - Usage statistics persistence tests are part of the v0.5.2 baseline.
   - Release checks must stay package-manager independent through `scripts/verify.mjs`.

## Sprint Plan

### Sprint A: Baseline Alignment

- Confirm the active repository is on GitHub `origin/main`.
- Record this plan.
- Add `test:usage` and include `test/usage-store-tests.mjs` in `scripts/verify.mjs`.
- Run build, syntax checks, usage tests, and full verify.

### Sprint B: Desktop Flow Fixes

- Fix desktop `/exit` handling.
- Tighten native app open interception.
- Update diff copy and tests.
- Reduce duplicated terminal-style tool output in chat without losing timeline evidence.

### Sprint C: Store Lifecycle Closure

- Verify install routing for Plugin, Skill, Agent, and MCP.
- Add or repair enable, disable, uninstall, and read-only states.
- Ensure store detail Chinese summaries are real local summaries or clearly marked source text.

### Sprint D: UI Release Polish

- Finish sidebar, settings, Git, Store, and Industrial Project responsive passes.
- Add focused renderer smoke checks where possible.
- Capture README screenshots.

### Sprint E: Release Candidate

- Run full verification.
- Run security and DoD scans.
- Build macOS and Windows packages.
- Generate SHA256 checksums and release notes.

## Out Of Scope For v0.5.2

- Real Codex CLI or Claude Code CLI provider integration.
- New industrial adapters.
- Cloud backend, billing, marketplace service, or hosted model gateway.
- Major renderer framework migration.

## Acceptance

- `npm run build` passes.
- `npm run verify` passes.
- `npm run release:check` passes.
- `node test/feature-tests.mjs` passes.
- `npm run test:usage` passes.
- GitHub README has no screenshot TODO before release publication.
- No new production path depends on mock-only data.
