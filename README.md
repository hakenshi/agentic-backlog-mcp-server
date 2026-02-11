# Agentic Backlog MCP Server

Local-first MCP server for AI agent backlog management.

Persistence: local SQLite (single file on host), no external infrastructure.

## Exposed tools

- `backlog.identify_project`
- `backlog.create_task`
- `backlog.list_tasks`
- `backlog.get_task`
- `backlog.update_task`
- `backlog.delete_task`
- `backlog.update_task_status`
- `backlog.add_task_note`
- `backlog.plan_from_context`
- `backlog.get_board`

## Requirements

- Bun 1.3+
- (Optional) OpenCode CLI for `plan_from_context`

## Run locally

```bash
bun install
bun run src/index.ts
```

## Local database

Default database path:

`~/.agentic-backlog/backlog.sqlite`

To customize:

```bash
BACKLOG_DB_PATH=./data/backlog.sqlite bun run src/index.ts
```

## MCP config example (project)

`.mcp.json` file:

```json
{
  "mcpServers": {
    "agentic-backlog": {
      "command": "bun",
      "args": [
        "run",
        "/ABSOLUTE/PATH/TO/agentic-backlog/mcp-server/src/index.ts"
      ],
      "env": {
        "BACKLOG_DB_PATH": "/ABSOLUTE/PATH/TO/.agentic-backlog/backlog.sqlite",
        "OPENCODE_CMD": "opencode",
        "OPENCODE_MODEL": ""
      }
    }
  }
}
```

## MCP notes

- This server uses `stdio` transport (ideal for local-first).
- Do not use `console.log` in MCP stdio mode (stdout breaks JSON-RPC). Logs must go to `stderr`.
- `backlog.delete_task` requires explicit `confirm: "DELETE"`.
- `backlog.plan_from_context` is preview-only by default. Set `apply: true` to persist changes.
