import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const runGit = (cwd: string, args: string[]): string => {
  const proc = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (proc.status !== 0) return "";
  return (proc.stdout ?? "").trim();
};

export const detectProject = (cwdInput?: string) => {
  const cwd = cwdInput && cwdInput.trim() ? cwdInput : process.cwd();
  const repoUrl = runGit(cwd, ["config", "--get", "remote.origin.url"]);
  const branch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]) || cwd;

  const rawKey = `${repoUrl || root}::${branch || "default"}`;
  const key = createHash("sha1").update(rawKey).digest("hex").slice(0, 16);

  return {
    key,
    cwd,
    root,
    repoUrl,
    branch,
    suggestedName: root.split("/").filter(Boolean).at(-1) ?? "project",
  };
};
