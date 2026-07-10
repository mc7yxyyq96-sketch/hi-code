# Hi Code 0.6.0-alpha.8 E2E Report

Status: Candidate gate passed

## Desktop Acceptance

The real Electron suite launches the production entrypoint with isolated home, user-data, and model fixture paths. It checks embedded Electron, Chromium, and Node versions; context isolation, Node integration, and sandbox state; navigation and window-open guards; protocol-native streamed model output; core actions; responsive reachability at 720, 1024, and 1440 content widths; and uncaught renderer errors.

HC-PLAT-110 recorded 13 local E2E checks passing on macOS and a GitHub Actions matrix with successful production-entrypoint startup plus artifact upload on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

## Candidate Gate

`npm run program:evidence:alpha8` repeated the real Electron E2E on the alpha.8 candidate and hashed its passing log. The same profile passed the Electron compatibility contract and macOS unsigned packaging. Passing CI startup is linked evidence, not a claim that signed installers were installed on physical end-user machines.
