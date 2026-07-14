# Hi Code 0.6.0-alpha.7 Known Limitations

- Event-only runtime sessions are visible for replay, but full resumable model context still depends on saved session JSON. HC-RUN-202 owns the typed store and reconstruction work.
- The compatibility stdout bridge still carries legacy command and tool console text. Assistant output no longer depends on it.
- External Codex CLI and Claude Code providers remain unconfigured, so this release does not advertise them as executable providers.
- Electron framework modernization is isolated to HC-PLAT-110 and is not part of alpha.7.
- macOS, Windows, and Linux production signing, update channels, SBOM, and provenance are assigned to HC-REL-420.
- SolidWorks and AVEVA integrations remain permission-gated bridge plans that require external licensed environments.
- Real industrial tool execution depends on locally installed tools and explicit approval; unavailable tools produce clearly marked dry-run evidence.
