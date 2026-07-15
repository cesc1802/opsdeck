// Pure presentation helpers for live jobs, kept out of the components so the
// status→action mapping and labels are unit-testable without a DOM.
import type { JobStatus, JobSummary } from "@/lib/bindings";

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "stopped",
  "interrupted",
  "error",
]);

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export type ComposerAction = "send" | "interrupt" | "ended";

/** What the composer's primary control does for a given job status. */
export function composerAction(status: JobStatus): ComposerAction {
  // A starting job accepts input: stdin is piped from spawn, and a promptless
  // launch stays "starting" until the first composer message begins a turn.
  if (status === "idle" || status === "starting") return "send";
  if (status === "running") return "interrupt";
  return "ended";
}

/** Best human label for a job row: explicit name, then cwd basename, id. */
export function jobLabel(job: JobSummary): string {
  if (job.name) return job.name;
  const basename = job.cwd.replace(/\/+$/, "").split("/").pop();
  if (basename) return basename;
  return job.job_id.slice(0, 8);
}

/** Compact elapsed time since `fromMs`: "42s", "3m 07s", "2h 15m". */
export function formatElapsed(fromMs: number, nowMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}
