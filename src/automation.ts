import { db, nowIso } from "./db";

const hasKeyword = (text: string, words: string[]) => words.some((w) => text.includes(w));

export const autoMoveByNote = (taskId: number, note: string) => {
  const row = db.query("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | null;
  if (!row) return null;

  const low = note.toLowerCase();
  let target = "";
  let reason = "";

  if (row.status === "todo" && hasKeyword(low, ["iniciei", "comecei", "start", "em andamento"])) {
    target = "in_progress";
    reason = "Start signal detected";
  } else if (row.status === "in_progress" && hasKeyword(low, ["bloqueado", "blocked", "impedido"])) {
    target = "blocked";
    reason = "Blocker signal detected";
  } else if (row.status === "blocked" && hasKeyword(low, ["desbloqueado", "resolvido", "unblocked"])) {
    target = "in_progress";
    reason = "Unblocked signal detected";
  } else if (row.status === "in_progress" && hasKeyword(low, ["finalizei", "conclui", "pronto", "merged"])) {
    target = "review";
    reason = "Completion signal detected";
  } else if (row.status === "review" && hasKeyword(low, ["aprovado", "approved", "qa ok"])) {
    target = "done";
    reason = "Approval signal detected";
  }

  if (!target) return null;

  db.query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(target, nowIso(), taskId);

  return {
    from: row.status,
    to: target,
    reason,
  };
};
