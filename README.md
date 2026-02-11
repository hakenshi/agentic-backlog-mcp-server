# Agentic Backlog MCP Server

Local-first MCP server for AI backlog management.

This package runs over `stdio` (Node.js) and forwards MCP tool calls to a running backlog API.

## Exposed tools

- `backlog.identify_project`
- `backlog.health`
- `backlog.version`
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
- `backlog.get_focus`
- `backlog.claim_task`
- `backlog.release_task`
- `backlog.restore_task`
- `backlog.get_board`
- `backlog.get_console_table`

## Requirements

- Node.js 18+

## Environment

```bash
BACKLOG_API_BASE_URL=http://127.0.0.1:38117/api
BACKLOG_REQUEST_TIMEOUT_MS=1800
BACKLOG_API_FAIL_FAST_MS=15000
BACKLOG_API_FAILURE_THRESHOLD=1
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
  "mcp": {
     "agentic-backlog": {
      "command": "npx",
      "args": ["-y", "@hakenshi/agentic-backlog-mcp-server"],
      "env": {
        "BACKLOG_API_BASE_URL": "http://127.0.0.1:38117/api"
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
- API resilience is fail-fast: when repeated timeout/5xx errors happen, the server opens a short circuit window and returns immediate 503 errors so agent runs do not stall.
