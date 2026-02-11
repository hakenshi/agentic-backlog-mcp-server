export const STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;

export const PRIORITIES = ["low", "medium", "high"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export type AgentCreateTaskAction = {
  action: "create_task";
  title: string;
  description?: string;
  priority?: Priority;
  reason?: string;
};

export type AgentMoveTaskAction = {
  action: "move_task";
  task_id: number;
  new_status: Status;
  reason?: string;
};

export type AgentAction = AgentCreateTaskAction | AgentMoveTaskAction;
