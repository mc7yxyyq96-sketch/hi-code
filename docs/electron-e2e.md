# Electron Responsive E2E

HC-QA-101 adds a real Playwright-driven Electron smoke suite. It launches the project's installed Electron binary, loads the production `renderer/index.html` through the normal main process and preload, and uses a temporary user-data directory.

## Commands

```bash
npm run build
npm run test:electron-e2e
```

Update reviewed screenshot fixtures intentionally:

```bash
npm run test:electron-e2e:update
```

The normal command never overwrites fixtures. Runtime screenshots and observed layout JSON are written to `test-results/electron-e2e/<platform>-<arch>/`.

## Coverage

At 720, 1024, 1440, and 1920 content widths the suite verifies:

- the real Electron window and local file renderer launch;
- the embedded Electron, Chromium, and Node versions match the pinned compatibility baseline;
- untrusted renderer navigation and renderer-created windows are blocked;
- the `Hi Code` brand remains fully visible;
- the workspace breadcrumb remains a single line and every visible top action stays inside the header;
- the root document has no horizontal overflow;
- Job Center, Patch Arena, Industrial Project, Git/diffs, Store, and Settings open through reachable controls;
- the typed React App Shell is mounted, synchronizes its route with legacy panels, and supplies real compact navigation at 720px;
- compact navigation closes on selection and Escape, restores focus, and cannot cover modal controls;
- small-window timeline and diff panels open as real drawers;
- desktop timeline and diff panels remain visible without drawer controls;
- renderer execution has no uncaught page error;
- screenshots are nonblank and committed reference fixtures exist.

Screenshot files are review references, while DOM geometry and real interaction assertions are the cross-platform regression gate. Exact pixel equality is deliberately not used across macOS and Linux because platform font rendering differs.

## CI

The `electron-smoke` matrix in `.github/workflows/ci.yml` launches the same production entrypoint on Ubuntu, macOS, and Windows. Ubuntu runs under `xvfb-run`; macOS and Windows launch directly. Per-platform runtime evidence and screenshots are uploaded even on failure. The regular unit-test job does not launch Electron.

## Security And Isolation

- The test process passes only basic desktop/session environment variables; API keys, tokens, secrets, and passwords are not inherited.
- `HOME`, `USERPROFILE`, and `--user-data-dir` point to the same ephemeral directory, so the app cannot read the developer's real `~/.vibe`, account, session, or model configuration.
- No model key is configured and no production account/session data is read.
- The chat workbench is opened with the local `/help` command; the smoke suite does not call a model endpoint.
- The test uses the same context isolation, renderer sandbox, preload, IPC handlers, and CSP as the desktop app.
