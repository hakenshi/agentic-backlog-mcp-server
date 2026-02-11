#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { detectProject } from "./git.js";

const API_BASE_URL = (
  process.env.BACKLOG_API_BASE_URL ?? "http://127.0.0.1:38117"
).replace(/\/$/, "");
const API_KEY = process.env.BACKLOG_API_KEY ?? "";

const statusSchema = z.union([
  z.literal("backlog"),
  z.literal("todo"),
  z.literal("in_progress"),
  z.literal("blocked"),
  z.literal("review"),
  z.literal("done"),
  z.literal("cancelled"),
]);

const prioritySchema = z.union([
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
]);

type Project = {
  id: number;
  name: string;
  description: string;
  created_at: string;
};

type Task = {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  ai_generated: boolean;
  blocked_reason: string;
  updated_at: string;
};

type ApiResult = {
  ok: boolean;
  status: number;
  data: unknown;
};

const request = async (
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<ApiResult> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (API_KEY) {
    headers["x-backlog-key"] = API_KEY;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
};

const asError = (error: string, status?: number, detail?: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify({ error, status, detail }) },
  ],
  isError: true,
});

const toSuccess = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload) }],
});

const findTaskCandidates = (tasks: Task[], query: string, limit = 25) => {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return tasks
    .filter((task) => task.title.toLowerCase().includes(q))
    .map((task) => {
      const title = task.title.toLowerCase();
      const score = title === q ? 100 : title.startsWith(q) ? 80 : 60;
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        updated_at: task.updated_at,
        score,
      };
    })
    .sort(
      (a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at),
    )
    .slice(0, limit);
};

const getProjects = async () => {
  const result = await request("/projects");
  if (!result.ok || !Array.isArray(result.data)) {
    return null;
  }
  return result.data as Project[];
};

const getProjectTasks = async (projectId: number) => {
  const result = await request(`/projects/${projectId}/tasks`);
  if (!result.ok || !Array.isArray(result.data)) {
    return null;
  }
  return result.data as Task[];
};

const server = new McpServer({
  name: "agentic-backlog-local",
  version: "0.2.0",
});

server.registerTool(
  "backlog.identify_project",
  {
    title: "Identify or create project",
    description:
      "Detects git context and resolves/creates a project in the running backlog API (Docker app source of truth).",
    inputSchema: {
      cwd: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
    },
  },
  async ({ cwd, name, description }) => {
    const detected = detectProject(cwd);
    const marker = `[mcp-key:${detected.key}]`;

    const projects = await getProjects();
    if (!projects) {
      return asError(
        "api_unavailable",
        503,
        "Could not list projects from backlog API",
      );
    }

    const existing = projects.find((project) =>
      project.description.includes(marker),
    );
    if (existing) {
      return toSuccess({
        project: existing,
        created: false,
        source: "backlog-api",
      });
    }

    const resolvedName = name?.trim() || detected.suggestedName;
    const resolvedDescription = `${marker}${description?.trim() ? ` ${description.trim()}` : ""}`;

    const createResult = await request("/projects", {
      method: "POST",
      body: {
        name: resolvedName,
        description: resolvedDescription,
      },
    });

    if (!createResult.ok) {
      return asError(
        "project_create_failed",
        createResult.status,
        createResult.data,
      );
    }

    return toSuccess({
      project: createResult.data,
      created: true,
      source: "backlog-api",
    });
  },
);

server.registerTool(
  "backlog.list_projects",
  {
    title: "List projects",
    description: "Lists projects from the running backlog API.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ limit }) => {
    const result = await request("/projects");
    if (!result.ok || !Array.isArray(result.data)) {
      return asError("list_projects_failed", result.status, result.data);
    }

    const projects = (result.data as Project[]).slice(0, limit ?? 50);
    return toSuccess({ projects });
  },
);

server.registerTool(
  "backlog.get_project",
  {
    title: "Get project",
    description:
      "Returns project metadata and board summary from the running backlog API.",
    inputSchema: {
      project_id: z.number().int(),
    },
  },
  async ({ project_id }) => {
    const projects = await getProjects();
    if (!projects) {
      return asError("api_unavailable", 503, "Could not list projects");
    }

    const project = projects.find((row) => row.id === project_id);
    if (!project) {
      return asError("project_not_found", 404);
    }

    const boardResult = await request(`/projects/${project_id}/board`);
    if (!boardResult.ok) {
      return asError(
        "project_board_failed",
        boardResult.status,
        boardResult.data,
      );
    }

    return toSuccess({
      project,
      counts: (boardResult.data as { counts?: unknown }).counts ?? {},
    });
  },
);

server.registerTool(
  "backlog.get_kanban_url",
  {
    title: "Get kanban URL",
    description:
      "Returns a browser URL for visual kanban from the running backlog API.",
    inputSchema: {
      project_id: z.number().int(),
      base_url: z.string().url().optional(),
    },
  },
  async ({ project_id, base_url }) => {
    const projects = await getProjects();
    if (!projects) {
      return asError("api_unavailable", 503, "Could not list projects");
    }

    const project = projects.find((row) => row.id === project_id);
    if (!project) {
      return asError("project_not_found", 404);
    }

    const root = (base_url ?? API_BASE_URL).replace(/\/$/, "");
    return toSuccess({
      project_id,
      project_name: project.name,
      kanban_url: `${root}/projects/${project_id}/kanban`,
    });
  },
);

server.registerTool(
  "backlog.create_task",
  {
    title: "Create task",
    description: "Creates a task through the running backlog API.",
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
  async ({ project_id, title, description, status, priority }) => {
    const result = await request(`/projects/${project_id}/tasks`, {
      method: "POST",
      body: {
        title,
        description,
        status,
        priority,
      },
    });

    if (!result.ok) {
      return asError("create_task_failed", result.status, result.data);
    }

    return toSuccess({ task: result.data });
  },
);

server.registerTool(
  "backlog.list_tasks",
  {
    title: "List tasks",
    description: "Lists project tasks from the running backlog API.",
    inputSchema: {
      project_id: z.number().int(),
      status: statusSchema.optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  async ({ project_id, status, limit }) => {
    const tasks = await getProjectTasks(project_id);
    if (!tasks) {
      return asError("list_tasks_failed", 404);
    }

    const filtered = status
      ? tasks.filter((task) => task.status === status)
      : tasks;
    return toSuccess({ tasks: filtered.slice(0, limit ?? 50) });
  },
);

server.registerTool(
  "backlog.get_task",
  {
    title: "Get task",
    description: "Returns a single task by id from the running backlog API.",
    inputSchema: {
      task_id: z.number().int(),
    },
  },
  async ({ task_id }) => {
    const result = await request(`/tasks/${task_id}`);
    if (!result.ok) {
      return asError("task_not_found", result.status, result.data);
    }
    return toSuccess({ task: result.data });
  },
);

server.registerTool(
  "backlog.find_tasks_by_title",
  {
    title: "Find tasks by title",
    description:
      "Finds tasks in a project by title keywords using backlog API task list.",
    inputSchema: {
      project_id: z.number().int(),
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ project_id, query, limit }) => {
    const tasks = await getProjectTasks(project_id);
    if (!tasks) {
      return asError("list_tasks_failed", 404);
    }

    const candidates = findTaskCandidates(tasks, query, limit ?? 25);
    return toSuccess({
      project_id,
      query,
      total: candidates.length,
      candidates,
    });
  },
);

server.registerTool(
  "backlog.update_task",
  {
    title: "Update task",
    description: "Updates task fields through the running backlog API.",
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
    source,
    reason,
  }) => {
    const result = await request(`/tasks/${task_id}`, {
      method: "PATCH",
      body: {
        title,
        description,
        priority,
        status,
        blocked_reason,
        source,
        note: reason,
      },
    });

    if (!result.ok) {
      return asError("update_task_failed", result.status, result.data);
    }

    return toSuccess({ task: result.data });
  },
);

server.registerTool(
  "backlog.update_task_by_title",
  {
    title: "Update task by title",
    description:
      "Finds a task by title query and updates it through the backlog API.",
    inputSchema: {
      project_id: z.number().int(),
      query: z.string().min(1).max(200),
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
    project_id,
    query,
    title,
    description,
    priority,
    status,
    blocked_reason,
    source,
    reason,
  }) => {
    const tasks = await getProjectTasks(project_id);
    if (!tasks) {
      return asError("list_tasks_failed", 404);
    }

    const candidates = findTaskCandidates(tasks, query, 15);
    if (candidates.length === 0) {
      return asError("task_not_found_by_title", 404, { query });
    }

    const top = candidates[0];
    const sameTopScore = candidates.filter(
      (candidate) => candidate.score === top.score,
    );
    if (top.score < 100 && sameTopScore.length > 1) {
      return asError("ambiguous_match", 409, {
        query,
        candidates: sameTopScore,
      });
    }

    const updateResult = await request(`/tasks/${top.id}`, {
      method: "PATCH",
      body: {
        title,
        description,
        priority,
        status,
        blocked_reason,
        source,
        note: reason,
      },
    });

    if (!updateResult.ok) {
      return asError(
        "update_task_failed",
        updateResult.status,
        updateResult.data,
      );
    }

    return toSuccess({
      task: updateResult.data,
      matched_by_title: query,
      matched_task_id: top.id,
      match_score: top.score,
    });
  },
);

server.registerTool(
  "backlog.delete_task",
  {
    title: "Delete task",
    description: "Deletes a task through the running backlog API.",
    inputSchema: {
      task_id: z.number().int(),
      confirm: z.literal("DELETE"),
    },
  },
  async ({ task_id }) => {
    const getResult = await request(`/tasks/${task_id}`);
    if (!getResult.ok) {
      return asError("task_not_found", getResult.status, getResult.data);
    }

    const deleteResult = await request(`/tasks/${task_id}`, {
      method: "DELETE",
    });
    if (!deleteResult.ok) {
      return asError(
        "delete_task_failed",
        deleteResult.status,
        deleteResult.data,
      );
    }

    return toSuccess({
      ok: true,
      deleted_task: (deleteResult.data as { deleted_task?: unknown })
        .deleted_task,
    });
  },
);

server.registerTool(
  "backlog.update_task_status",
  {
    title: "Update task status",
    description: "Moves a task between states through the running backlog API.",
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
  async ({ task_id, status, reason, source, blocked_reason }) => {
    if (blocked_reason && status === "blocked") {
      const patchResult = await request(`/tasks/${task_id}`, {
        method: "PATCH",
        body: {
          status,
          blocked_reason,
          source,
          note: reason,
        },
      });
      if (!patchResult.ok) {
        return asError(
          "update_task_status_failed",
          patchResult.status,
          patchResult.data,
        );
      }
      return toSuccess({ task: patchResult.data });
    }

    const result = await request(`/tasks/${task_id}/status`, {
      method: "PATCH",
      body: {
        status,
        source,
        note: reason,
      },
    });
    if (!result.ok) {
      return asError("update_task_status_failed", result.status, result.data);
    }

    return toSuccess({ task: result.data });
  },
);

server.registerTool(
  "backlog.add_task_note",
  {
    title: "Add task note",
    description: "Adds a task note through the running backlog API.",
    inputSchema: {
      task_id: z.number().int(),
      note: z.string().min(2).max(4000),
      source: z.string().optional(),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
      apply_automation: z.boolean().optional(),
    },
  },
  async ({ task_id, note, source, apply_automation }) => {
    const result = await request(`/tasks/${task_id}/notes`, {
      method: "POST",
      body: {
        note,
        source,
      },
    });
    if (!result.ok) {
      return asError("add_task_note_failed", result.status, result.data);
    }

    return toSuccess({
      ...(result.data as Record<string, unknown>),
      apply_automation_requested: apply_automation ?? true,
    });
  },
);

server.registerTool(
  "backlog.plan_from_context",
  {
    title: "Plan tasks from context",
    description: "Delegates planning to running backlog API planner endpoint.",
    inputSchema: {
      project_id: z.number().int(),
      context: z.string().min(4).max(7000),
      dry_run: z.boolean().optional(),
      apply: z.boolean().optional(),
      source: z.string().optional(),
      agent_id: z.string().optional(),
      session_id: z.string().optional(),
    },
  },
  async ({ project_id, context, dry_run, apply }) => {
    const shouldApply = apply ?? (dry_run !== undefined ? !dry_run : false);
    const result = await request(`/agent/projects/${project_id}/plan`, {
      method: "POST",
      body: {
        context,
        dry_run: !shouldApply,
      },
    });
    if (!result.ok) {
      return asError("plan_from_context_failed", result.status, result.data);
    }

    return toSuccess(result.data);
  },
);

server.registerTool(
  "backlog.get_board",
  {
    title: "Get board snapshot",
    description: "Returns board grouped snapshot from the running backlog API.",
    inputSchema: {
      project_id: z.number().int(),
    },
  },
  async ({ project_id }) => {
    const result = await request(`/projects/${project_id}/board`);
    if (!result.ok) {
      return asError("get_board_failed", result.status, result.data);
    }
    return toSuccess(result.data);
  },
);

server.registerTool(
  "backlog.get_console_table",
  {
    title: "Get board as console table",
    description:
      "Returns a console-table style board snapshot from backlog API.",
    inputSchema: {
      project_id: z.number().int(),
      limit: z.number().int().min(1).max(300).optional(),
    },
  },
  async ({ project_id }) => {
    const result = await request(`/projects/${project_id}/board/console-table`);
    if (!result.ok) {
      return asError("get_console_table_failed", result.status, result.data);
    }
    return toSuccess(result.data);
  },
);

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[agentic-backlog-mcp] stdio ready. api=${API_BASE_URL}`);
};

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
