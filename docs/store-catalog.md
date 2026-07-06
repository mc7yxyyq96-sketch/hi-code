# Hi Code Store Catalog

Hi Code 商店源是一个 JSON catalog。Electron 主进程会先校验条目，再把可安装列表交给 renderer；无效条目不会出现在安装列表里。

## Source Format

推荐远端源返回对象格式：

```json
{
  "version": "1",
  "updatedAt": "2026-06-29T00:00:00Z",
  "items": [
    {
      "id": "mcp-github",
      "kind": "mcp",
      "category": "git",
      "name": "GitHub MCP",
      "summary": "连接 GitHub issue、PR、repo 上下文。",
      "tags": ["mcp", "github", "git"],
      "source": "npm",
      "install": {
        "kind": "mcp",
        "server": {
          "name": "github",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": {
            "GITHUB_TOKEN": "填入你的 GitHub token"
          }
        }
      }
    }
  ]
}
```

也兼容直接返回条目数组：

```json
[
  {
    "id": "skill-playwright",
    "kind": "skill",
    "category": "browser",
    "name": "Playwright UI 验证",
    "summary": "驱动真实浏览器做 UI 流程验证。",
    "install": {
      "kind": "skill",
      "dir": "playwright-ui",
      "skill": {
        "name": "playwright-ui",
        "description": "Use when validating local web UI with Playwright.",
        "body": "Open the target, snapshot, interact, and capture screenshots."
      }
    }
  }
]
```

## Install Kinds

- `skill`: writes `~/.vibe/store/skills/<dir>/SKILL.md`.
- `mcp`: updates `~/.vibe/config.json` under `mcpServers.<name>`.
- `agent`: writes `~/.vibe/store/agents/<id>.json`.
- `plugin`: writes `~/.vibe/store/plugins/<name>/plugin.json`.
- `download`: downloads a file into `~/.vibe/store/downloads/<id>/` and records a manifest.

Download installs are visible in the matching capability list after install:

- A zip containing `SKILL.md` is imported into `~/.vibe/store/skills/<id>/`.
- A zip containing `.codex-plugin/plugin.json` is imported into `~/.vibe/store/plugins/<id>/`.
- Unknown GitHub zips are cached and recorded as Store-managed entries; Hi Code does not execute downloaded code automatically.

Installed entries support `enable`, `disable`, and `uninstall`. Disabled Store-managed paths are hidden from capability scans. Uninstall removes only paths under `~/.vibe/store` and removes Store-managed MCP config entries from `~/.vibe/config.json`.

## China-Friendly Mirrors

For download entries, prefer a `mirrors` map:

```json
{
  "install": {
    "kind": "download",
    "url": "https://github.com/example/plugin/releases/download/v1/plugin.zip",
    "mirrors": {
      "gitee-mirror": "https://gitee.com/example/plugin/releases/download/v1/plugin.zip",
      "CN": "https://example.oss-cn-hangzhou.aliyuncs.com/plugin.zip"
    },
    "filename": "plugin.zip",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

When the active source is a China-friendly source, Hi Code also injects the configured npm registry mirror for `npx` based MCP installs.

For `download` entries, Hi Code tries candidate URLs in order: source-specific mirror, region mirror, other declared mirrors, then the direct `url`. This lets the GitHub domestic proxy fail with HTTP 403 without blocking installation when GitHub direct download is available.

## Validation

Schema: `docs/store-catalog.schema.json`.

Runtime validation additionally blocks path separators in install directories and filenames, unsupported install kinds, malformed MCP server configs, and invalid download URLs. Installation always shows a permission and file-change preview before writing local files.
