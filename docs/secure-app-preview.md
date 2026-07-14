# Secure App Preview

HC-UI-312 adds a real local-web preview and verification surface to Hi Code. It is intended for applications already served by a developer tool on the local machine. Hi Code does not start a server, inject a preload bridge, or render a simulated page.

## User Flow

1. Start the application server in the integrated terminal, Runtime, or another trusted local process.
2. Open **App Preview** from the sidebar or compact workspace drawer.
3. Enter a canonical loopback URL such as `http://127.0.0.1:3000/` and optional CSS selectors.
4. Select **Open isolated preview**. Hi Code opens a separate child window owned by the current renderer and workspace.
5. Select **Capture and verify** to persist a PNG, bounded DOM metadata, and per-check results.
6. Close, reopen, reload, or remove the registered preview from the workbench.

The preview registry is in memory. A window close preserves the record for reopening; removing the record, switching workspace, closing the owner, or quitting Hi Code destroys its child window.

## Security Boundary

Only canonical `http:` URLs whose hostname is `localhost`, `127.0.0.1`, or `[::1]` are accepted. URL credentials and fragments are rejected. HTTPS, remote hosts, filesystem URLs, and non-HTTP schemes are not preview targets in this version.

Every preview uses a unique, non-persistent Electron session partition and these BrowserWindow preferences:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- no preload script
- DevTools disabled

The main process denies popups, downloads, permission requests, webview attachment, external navigation, redirects, and cross-origin HTTP/WebSocket resources. Same-origin loopback resources plus browser-local `data:`, `blob:`, and `about:` resources are permitted. A blocked navigation is surfaced in the owning workbench rather than silently ignored.

The trusted Hi Code renderer is never navigated to preview content. It receives bounded record metadata through typed IPC and cannot access the child BrowserWindow or its Electron session.

## Verification Evidence

Verification writes under the selected Hi Code app-data root:

```text
~/.hicode/preview-evidence/<preview-id>/<verification-id>/
  evidence.json
  preview.png
```

Existing installations that still use the compatible `~/.vibe` data root write to the corresponding directory there. Directories use owner-only permissions and evidence files use mode `0600`.

`evidence.json` contains:

- preview and verification IDs
- checked URL, origin, title, and timestamp
- requested selectors and their match counts
- ready-state, viewport, document dimensions, text-length, and landmark counts
- screenshot path and byte count
- explicit check statuses and diagnostics

The DOM body content is not persisted. A verification is `passed` only when every check passes. A missing selector, unloaded document, URL/origin mismatch, DOM evaluation error, or missing screenshot remains `failed`; no simulated or `not_run` result is promoted to passed.

## API And Ownership

`electron/services/preview-service.mjs` owns URL validation, BrowserWindow creation, isolation policy, lifecycle, and evidence. `electron/preload.cjs` exposes only bounded methods:

- `previewCapabilities`
- `openPreview`
- `listPreviews`
- `reopenPreview`
- `reloadPreview`
- `verifyPreview`
- `closePreview`
- `removePreview`
- `onPreviewEvent`

Preview IDs are opaque and owner-scoped. Calls from a different renderer owner or after a workspace switch fail closed. Browser-only development mode reports the feature as unavailable instead of rendering a fake preview.

## Verification

```bash
npm run build
npm run test:preview
npm run test:services
npm run test:security
npm run test:electron-e2e
npm run verify
```

The service test verifies URL policy, isolation options, resource and permission denial, truthful evidence, reload/reopen, ownership, workspace switching, and failure cleanup. Real Electron E2E opens a local fixture, proves Node and the Hi Code preload are absent, proves DevTools/popups/navigation are blocked, reloads the page, captures evidence, and checks the compact layout.
