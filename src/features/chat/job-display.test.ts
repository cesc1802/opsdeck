import { describe, expect, it } from "vitest";
import type { JobStatus, JobSummary } from "@/lib/bindings";
import {
  composerAction,
  formatElapsed,
  isTerminalStatus,
  jobLabel,
} from "./job-display";

function job(overrides: Partial<JobSummary>): JobSummary {
  return {
    job_id: "0a1b2c3d-0000-0000-0000-000000000000",
    session_id: null,
    pid: 1234,
    status: "running",
    cwd: "/Users/dev/projects/opsdeck",
    name: null,
    model: null,
    effort: null,
    permission_mode: null,
    created_at_ms: 0,
    cost_usd: null,
    usage: null,
    ...overrides,
  };
}

describe("composerAction", () => {
  it("maps each job status to the matching composer control", () => {
    const expected: Record<JobStatus, string> = {
      idle: "send",
      running: "interrupt",
      starting: "send",
      completed: "ended",
      stopped: "ended",
      interrupted: "ended",
      error: "ended",
    };
    for (const [status, action] of Object.entries(expected)) {
      expect(composerAction(status as JobStatus)).toBe(action);
    }
  });
});

describe("isTerminalStatus", () => {
  it("treats starting, running, and idle as live", () => {
    expect(isTerminalStatus("starting")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("idle")).toBe(false);
  });

  it("treats every finished status as terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("stopped")).toBe(true);
    expect(isTerminalStatus("interrupted")).toBe(true);
    expect(isTerminalStatus("error")).toBe(true);
  });
});

describe("jobLabel", () => {
  it("prefers the explicit name", () => {
    expect(jobLabel(job({ name: "refactor auth" }))).toBe("refactor auth");
  });

  it("falls back to the cwd basename, tolerating trailing slashes", () => {
    expect(jobLabel(job({ cwd: "/Users/dev/projects/opsdeck/" }))).toBe(
      "opsdeck",
    );
  });

  it("falls back to a shortened job id when cwd has no basename", () => {
    expect(jobLabel(job({ cwd: "///" }))).toBe("0a1b2c3d");
  });
});

describe("formatElapsed", () => {
  it("renders seconds, minutes, and hours compactly", () => {
    expect(formatElapsed(0, 42_000)).toBe("42s");
    expect(formatElapsed(0, 187_000)).toBe("3m 07s");
    expect(formatElapsed(0, 8_100_000)).toBe("2h 15m");
  });

  it("clamps clock skew to zero", () => {
    expect(formatElapsed(10_000, 0)).toBe("0s");
  });
});
