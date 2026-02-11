import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { autoMoveByNote } from "./automation";
import { backlogInfo, db, nowIso } from "./db";
import { detectProject } from "./git";
import { planActions } from "./planner";

const statusSchema = z.union([
  z.literal("backlog"),
  z.literal("todo"),
  z.literal("in_progress"),
  z.literal("blocked"),
  z.literal("review"),
  z.literal("done"),
  z.literal("cancelled"),
]);

const prioritySchema = z.union([z.literal("low"), z.literal("medium"), z.literal("high")]);

const server = new McpServer({
  name: "agentic-backlog-local",
  version: "0.1.0",
});

server.registerTool(
  "backlog.identify_project",
  {
    title: "Identify or create project",
    description:
      "Detects git context from cwd and upserts a local backlog project. Use this before creating or moving tasks.",
    inputSchema: {
      cwd: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
    },
  },
  async ({ cwd, name, description }) => {
    const detected = detectProject(cwd);
    const now = nowIso();

    const existing = db.query("SELECT * FROM projects WHERE key = ?").get(detected.key) as
      | { id: number }
      | undefined;

    if (!existing) {
      const info = db
        .query(
          "INSERT INTO projects (key, name, description, repo_url, branch, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          detected.key,
          name?.trim() || detected.suggestedName,
          description?.trim() || "",
          detected.repoUrl,
          detected.branch,
          detected.root,
          now,
          now
        );

      const row = db.query("SELECT * FROM projects WHERE id = ?").get(Number(info.lastInsertRowid));
      return {
        content: [{ type: "text", text: JSON.stringify({ project: row, created: true, dbPath: backlogInfo.dbPath }) }],
      };
    }

    db.query("UPDATE projects SET updated_at = ?, cwd = ?, branch = ?, repo_url = ? WHERE id = ?").run(
      now,
      detected.root,
      detected.branch,
      detected.repoUrl,
      existing.id
    );

    const row = db.query("SELECT * FROM projects WHERE id = ?").get(existing.id);
    return {
      content: [{ type: "text", text: JSON.stringify({ project: row, created: false, dbPath: backlogInfo.dbPath }) }],
    };
  }
);

server.registerTool(
  "backlog.create_task",
  {
    title: "Create task",
    description: "Creates a task in a project.",
    inputSchema: {
      project_id: z.number().int(),
      title: z.string().min(3).max(200),
      description: z.string().optional(),
      status: statusSchema.optional(),
      priority: prioritySchema.optional(),
      source: z.string().optional(),
      external_ref: z.string().optional(),
    },
  },
  async ({ project_id, title, description, status, priority, source, external_ref }) => {
    const project = db.query("SELECT id FROM projects WHERE id = ?").get(project_id);
    if (!project) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "project_not_found" }) }], isError: true };
    }

    const now = nowIso();
    const info = db
      .query(
        "INSERT INTO tasks (project_id, title, description, status, priority, source, blocked_reason, external_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)"
      )
      .run(
        project_id,
        title,
        description ?? "",
        status ?? "backlog",
        priority ?? "medium",
        source ?? "agent",
        external_ref ?? "",
        now,
        now
      );

    const taskId = Number(info.lastInsertRowid);
    db.query(
      "INSERT INTO task_events (task_id, from_status, to_status, reason, source, agent_id, session_id, created_at) VALUES (?, NULL, ?, ?, ?, '', '', ?)"
    ).run(taskId, status ?? "backlog", "Task created", source ?? "agent", now);

    const row = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId);
    return { content: [{ type: "text", text: JSON.stringify({ task: row }) }] };
  }
);

server.registerTool(
  "backlog.list_tasks",
  {
    title: "List tasks",
    description: "Lists project tasks with optional status filter.",
    inputSchema: {
      project_id: z.number().int(),
      status: statusSchema.optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ project_id, status, limit }) => {
    const max = limit ?? 50;

    const rows = status
      ? db
          .query("SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY id DESC LIMIT ?")
          .all(project_id, status, max)
      : db.query("SELECT * FROM tasks WHERE project_id = ? ORDER BY id DESC LIMIT ?").all(project_id, max);

    return { content: [{ type: "text", text: JSON.stringify({ tasks: rows }) }] };
  }
);

server.registerTool(
  "backlog.get_task",
  {
    title: "Get task",
    description: "Returns a single task by id.",
    inputSchema: {
      task_id: z.number().int(),
    },
  },
  async ({ task_id }) => {
    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(task_id);
    if (!task) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "task_not_found" }) }], isError: true };
    }

    const notes = db
      .query("SELECT id, note, source, agent_id, session_id, created_at FROM task_notes WHERE task_id = ? ORDER BY id DESC")
      .all(task_id);
    const events = db
      .query(
        "SELECT id, from_status, to_status, reason, source, agent_id, session_id, created_at FROM task_events WHERE task_id = ? ORDER BY id DESC"
      )
      .all(task_id);

    return { content: [{ type: "text", text: JSON.stringify({ task, notes, events }) }] };
  }
);

server.registerTool(
  "backlog.update_task",
  {
    title: "Update task",
    description: "Updates task fields. If status changes, an event is recorded.",
    inputSchema: {
      task_id: z.number().int(),
      title: z.string().min(3).max(200).optional(),
      description: z.string().max(10000).optional(),
      priority: prioritySchema.optional(),
      status: statusSchema.optional(),
      blocked_reason: z.string().max(2000).optional(),
      external_ref: z.string().max(500).optional(),
      source: z.string().optional(),
      reason: z.string().optional(),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
    },
  },
  async ({
    task_id,
    title,
    description,
    priority,
    status,
    blocked_reason,
    external_ref,
    source,
    reason,
    agent_id,
    session_id,
  }) => {
    const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(task_id) as
      | { title: string; description: string; priority: string; status: string; blocked_reason: string; external_ref: string }
      | null;
    if (!existing) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "task_not_found" }) }], isError: true };
    }

    const nextTitle = title ?? existing.title;
    const nextDescription = description ?? existing.description;
    const nextPriority = priority ?? existing.priority;
    const nextStatus = status ?? existing.status;
    const nextBlockedReason = blocked_reason ?? (nextStatus === "blocked" ? existing.blocked_reason : "");
    const nextExternalRef = external_ref ?? existing.external_ref;
    const now = nowIso();

    db.query(
      "UPDATE tasks SET title = ?, description = ?, priority = ?, status = ?, blocked_reason = ?, external_ref = ?, updated_at = ? WHERE id = ?"
    ).run(nextTitle, nextDescription, nextPriority, nextStatus, nextBlockedReason, nextExternalRef, now, task_id);

    if (nextStatus !== existing.status) {
      db.query(
        "INSERT INTO task_events (task_id, from_status, to_status, reason, source, agent_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        task_id,
        existing.status,
        nextStatus,
        reason ?? "Task updated",
        source ?? "agent",
        agent_id ?? "",
        session_id ?? "",
        now
      );
    }

    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(task_id);
    return { content: [{ type: "text", text: JSON.stringify({ task }) }] };
  }
);

server.registerTool(
  "backlog.delete_task",
  {
    title: "Delete task",
    description: "Deletes a task permanently from the local backlog.",
    inputSchema: {
      task_id: z.number().int(),
    },
  },
  async ({ task_id }) => {
    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(task_id);
    if (!task) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "task_not_found" }) }], isError: true };
    }

    db.query("DELETE FROM tasks WHERE id = ?").run(task_id);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, deleted_task: task }) }] };
  }
);

server.registerTool(
  "backlog.update_task_status",
  {
    title: "Update task status",
    description: "Moves a task between states and records an event.",
    inputSchema: {
      task_id: z.number().int(),
      status: statusSchema,
      reason: z.string().optional(),
      source: z.string().optional(),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
      blocked_reason: z.string().optional(),
    },
  },
  async ({ task_id, status, reason, source, agent_id, session_id, blocked_reason }) => {
    const task = db.query("SELECT * FROM tasks WHERE id = ?").get(task_id) as { status: string } | null;
    if (!task) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "task_not_found" }) }], isError: true };
    }

    const now = nowIso();
    db.query("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
      status,
      blocked_reason ?? "",
      now,
      task_id
    );
    db.query(
      "INSERT INTO task_events (task_id, from_status, to_status, reason, source, agent_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      task_id,
      task.status,
      status,
      reason ?? "",
      source ?? "agent",
      agent_id ?? "",
      session_id ?? "",
      now
    );

    const row = db.query("SELECT * FROM tasks WHERE id = ?").get(task_id);
    return { content: [{ type: "text", text: JSON.stringify({ task: row }) }] };
  }
);

server.registerTool(
  "backlog.add_task_note",
  {
    title: "Add task note",
    description: "Adds a task note and can auto-move status by note content.",
    inputSchema: {
      task_id: z.number().int(),
      note: z.string().min(2).max(4000),
      source: z.string().optional(),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
      apply_automation: z.boolean().optional(),
    },
  },
  async ({ task_id, note, source, agent_id, session_id, apply_automation }) => {
    const task = db.query("SELECT id FROM tasks WHERE id = ?").get(task_id);
    if (!task) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "task_not_found" }) }], isError: true };
    }

    const now = nowIso();
    db.query(
      "INSERT INTO task_notes (task_id, note, source, agent_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(task_id, note, source ?? "agent", agent_id ?? "", session_id ?? "", now);

    let autoMove: null | { from: string; to: string; reason: string } = null;
    if (apply_automation ?? true) {
      autoMove = autoMoveByNote(task_id, note);
      if (autoMove) {
        db.query(
          "INSERT INTO task_events (task_id, from_status, to_status, reason, source, agent_id, session_id, created_at) VALUES (?, ?, ?, ?, 'automation', ?, ?, ?)"
        ).run(task_id, autoMove.from, autoMove.to, autoMove.reason, agent_id ?? "", session_id ?? "", nowIso());
      }
    }

    return { content: [{ type: "text", text: JSON.stringify({ ok: true, auto_move: autoMove }) }] };
  }
);

server.registerTool(
  "backlog.plan_from_context",
  {
    title: "Plan tasks from context",
    description: "Uses local OpenCode to suggest/create backlog actions from free-text project context.",
    inputSchema: {
      project_id: z.number().int(),
      context: z.string().min(4).max(7000),
      dry_run: z.boolean().optional(),
      source: z.string().optional(),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
    },
  },
  async ({ project_id, context, dry_run, source, agent_id, session_id }) => {
    const project = db.query("SELECT * FROM projects WHERE id = ?").get(project_id) as
      | { id: number; name: string; description: string }
      | null;
    if (!project) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "project_not_found" }) }], isError: true };
    }

    const tasks = db
      .query("SELECT id, title, status, priority FROM tasks WHERE project_id = ? ORDER BY id DESC LIMIT 60")
      .all(project_id);

    const result = planActions({ context, project: { ...project, tasks } });
    const actions = result.actions;
    let applied = 0;

    if (!(dry_run ?? false)) {
      for (const action of actions) {
        if (action.action === "create_task" && action.title) {
          const now = nowIso();
          const info = db
            .query(
              "INSERT INTO tasks (project_id, title, description, status, priority, source, blocked_reason, external_ref, created_at, updated_at) VALUES (?, ?, ?, 'backlog', ?, ?, '', '', ?, ?)"
            )
            .run(
              project_id,
              action.title,
              action.description ?? "",
              action.priority ?? "medium",
              source ?? "agent",
              now,
              now
            );
          const taskId = Number(info.lastInsertRowid);
          db.query(
            "INSERT INTO task_events (task_id, from_status, to_status, reason, source, agent_id, session_id, created_at) VALUES (?, NULL, 'backlog', ?, ?, ?, ?, ?)"
          ).run(taskId, action.reason ?? "", source ?? "agent", agent_id ?? "", session_id ?? "", now);
          applied += 1;
        }

        if (action.action === "move_task" && action.task_id && action.new_status) {
          const current = db
            .query("SELECT status FROM tasks WHERE id = ? AND project_id = ?")
            .get(action.task_id, project_id) as
            | { status: string }
            | null;
          if (!current) continue;

          db.query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(
            action.new_status,
            nowIso(),
            action.task_id
          );
          db.query(
            "INSERT INTO task_events (task_id, from_status, to_status, reason, source, agent_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(
            action.task_id,
            current.status,
            action.new_status,
            action.reason ?? "",
            source ?? "agent",
            agent_id ?? "",
            session_id ?? "",
            nowIso()
          );
          applied += 1;
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            project_id,
            model: result.model,
            dry_run: dry_run ?? false,
            error: result.error,
            actions,
            applied,
          }),
        },
      ],
    };
  }
);

server.registerTool(
  "backlog.get_board",
  {
    title: "Get board snapshot",
    description: "Returns grouped tasks by status for a project.",
    inputSchema: {
      project_id: z.number().int(),
    },
  },
  async ({ project_id }) => {
    const statuses = ["backlog", "todo", "in_progress", "blocked", "review", "done", "cancelled"];
    const board: Record<string, unknown[]> = {};

    for (const status of statuses) {
      board[status] = db
        .query("SELECT id, title, priority, updated_at FROM tasks WHERE project_id = ? AND status = ? ORDER BY id DESC")
        .all(project_id, status);
    }

    return { content: [{ type: "text", text: JSON.stringify({ project_id, board }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[agentic-backlog-mcp] stdio ready. db=${backlogInfo.dbPath}`);
