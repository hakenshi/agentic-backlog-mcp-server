# Agentic Backlog MCP Server

Local-first MCP server for AI backlog management.

This package runs over `stdio` (Node.js) and forwards MCP tool calls to a running backlog API.

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

- Node.js 18+

## Environment

```bash
BACKLOG_API_BASE_URL=http://127.0.0.1:8000
BACKLOG_API_KEY=
```

## Run locally

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

## MCP config example

`.mcp.json` file:

```json
{
  "mcpServers": {
    "agentic-backlog": {
      "command": "npx",
      "args": ["-y", "@hakenshi/agentic-backlog-mcp-server"],
      "env": {
        "BACKLOG_API_BASE_URL": "http://127.0.0.1:8000",
        "BACKLOG_API_KEY": ""
      }
    }
  }
}
```

## Notes

- This server uses `stdio` transport only.
- Do not use `console.log` in MCP stdio mode (stdout breaks JSON-RPC). Logs must go to `stderr`.
- `backlog.delete_task` requires explicit `confirm: "DELETE"`.
- `backlog.plan_from_context` is preview-only by default. Set `apply: true` to persist changes.
