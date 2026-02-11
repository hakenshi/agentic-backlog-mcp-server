# Agentic Backlog MCP Server

Local-first MCP server for AI agent backlog management.

This server is an MCP adapter for a running backlog API (for example the Docker Elysia app).

## Boundary (important)

- MCP is the communication channel agents use.
- The backlog application/API is the operational source of truth.
- Skill files are documentation/procedure for agents, not runtime storage or business logic.

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

## Required environment

The MCP server talks to the running backlog API:

```bash
BACKLOG_API_BASE_URL=http://127.0.0.1:8000
BACKLOG_API_KEY=
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
        "BACKLOG_API_BASE_URL": "http://127.0.0.1:8000",
        "BACKLOG_API_KEY": ""
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
