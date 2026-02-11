import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const defaultPath = resolve(homedir(), ".agentic-backlog", "backlog.sqlite");
const dbPath = process.env.BACKLOG_DB_PATH
  ? resolve(process.env.BACKLOG_DB_PATH)
  : defaultPath;

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  repo_url TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  cwd TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  source TEXT NOT NULL,
  blocked_reason TEXT DEFAULT '',
  external_ref TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  source TEXT NOT NULL,
  agent_id TEXT DEFAULT '',
  session_id TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT DEFAULT '',
  source TEXT NOT NULL,
  agent_id TEXT DEFAULT '',
  session_id TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
`);

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export const backlogInfo = {
  dbPath,
};
