# Agentic Backlog MCP Server

Local-first MCP server for AI agent backlog management.

Persistence: local SQLite (single file on host), no external infrastructure.

## Exposed tools

- `backlog.identify_project`
- `backlog.list_projects`
- `backlog.get_project`
- `backlog.get_kanban_url`
- `backlog.create_task`
- `backlog.list_tasks`
- `backlog.get_task`
- `backlog.find_tasks_by_title`
- `backlog.update_task`
- `backlog.update_task_by_title`
- `backlog.delete_task`
- `backlog.update_task_status`
- `backlog.add_task_note`
- `backlog.plan_from_context`
- `backlog.get_board`
- `backlog.get_console_table`

## Requirements

- Bun 1.3+
- (Optional) OpenCode CLI for `plan_from_context`

## Run locally

```bash
bun install
bun run src/index.ts
```

## Quick demo (MCP flow)

Typical agent sequence:

1. `backlog.identify_project`
2. `backlog.create_task`
3. `backlog.update_task_status` (move to `in_progress`)
4. `backlog.add_task_note`
5. `backlog.get_console_table`
6. `backlog.get_kanban_url`

Useful title-based helpers:

- `backlog.find_tasks_by_title`
- `backlog.update_task_by_title`

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
