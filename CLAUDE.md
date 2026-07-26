@AGENTS.md

## Claude Code specifics

- This repository is also a Claude Code plugin: `.claude-plugin/plugin.json`
  registers the bundled MCP server; the seven skills under `skills/` and the
  `impl-worker` agent under `agents/` are auto-discovered (skills namespaced as
  `/loopbreaker:<skill-name>`).
- `.mcp.json` doubles as the project-scope MCP config, so working inside this
  repository loads the `loopbreaker` server directly.
- `skills/*/agents/openai.yaml` files are Codex-only metadata; Claude Code
  ignores them. Keep both manifests (`.codex-plugin/` and `.claude-plugin/`)
  in sync — `pnpm verify` checks name, version, and MCP entry point for both.
