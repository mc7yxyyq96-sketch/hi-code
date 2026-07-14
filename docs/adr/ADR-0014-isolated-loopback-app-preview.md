# ADR-0014: Isolated Loopback App Preview

Status: Accepted

Date: 2026-07-11

## Context

Hi Code can edit files and run a real PTY, but application work also needs a repeatable way to inspect the locally served result. Navigating the trusted renderer, embedding arbitrary content in an iframe, or exposing BrowserWindow control through preload would let untrusted application content approach Hi Code's privileged UI and IPC bridge. A visual-only fake would not verify the application.

The first preview release needs deterministic security and evidence before broader browser automation. It must work for common local servers while keeping remote sites, credentials, permissions, downloads, and cross-origin resources out of scope.

## Decision

1. Accept only canonical loopback `http:` URLs with no credentials or fragment.
2. Keep ownership in a main-process preview service. The renderer receives typed, bounded records and commands, never BrowserWindow, session, or generic IPC authority.
3. Open every application in a separate sandboxed child BrowserWindow with context isolation, no Node integration, no preload, DevTools disabled, and a unique non-persistent session partition.
4. Deny popups, downloads, permissions, webviews, external navigation and redirects, and cross-origin HTTP/WebSocket resources. Surface blocked navigation to the owning workbench.
5. Bind each preview to one renderer owner and one canonical workspace. Destroy its live window when the owner, workspace, or application closes.
6. Persist owner-only PNG and bounded DOM metadata under app data. Do not persist body text, cookies, local storage, credentials, or arbitrary page content.
7. Report verification as passed only when every recorded check passes. Preserve failed checks and diagnostics; do not synthesize success.
8. Keep server startup outside this service. Users may use the policy-bound terminal, Runtime, or another local process.

## Consequences

- Developers can inspect and verify a real local application without granting that page access to Hi Code's trusted renderer or preload bridge.
- The first version is deliberately loopback-only and does not provide remote browsing, authenticated previews, Chromium DevTools, browser scripting, network replay, or mobile emulation.
- Same-origin application resources work, while CDN resources and third-party APIs are blocked in the preview session. The UI makes this restriction visible.
- Evidence is reproducible and auditable but not a full accessibility, visual-regression, or end-to-end test report.
- Live preview state is ephemeral. Evidence files remain under app data until normal user-data cleanup.

## Rejected Alternatives

- **Navigate the main Hi Code window:** rejected because remote or generated content would share a trusted renderer lifecycle.
- **Use an iframe or webview in the workbench:** rejected because webview attachment expands Electron attack surface and an iframe cannot enforce the complete process/session policy.
- **Expose BrowserWindow methods in preload:** rejected because the renderer must not own native window or session authority.
- **Allow arbitrary remote URLs:** rejected because it adds authentication, certificate, tracking, download, and navigation policy before the local workflow is proven.
- **Store the complete DOM:** rejected because application text may contain secrets and is unnecessary for selector and layout evidence.
- **Mark a screenshot as success:** rejected because an image alone cannot prove requested selectors or a complete document state.

## Verification And Rollback Gates

- Focused service and typed renderer contract tests.
- Main-process IPC registration and Electron security-baseline tests.
- Real Electron local-server acceptance for isolation, reload, popup/navigation denial, evidence, lifecycle, and compact layout.
- Full build, verify, release check, DoD scan, and production audit.

Rollback removes the preview route, typed API, preload channels, service registration, and in-memory registry. Existing evidence directories are inert app-data artifacts and require no user-data migration.
