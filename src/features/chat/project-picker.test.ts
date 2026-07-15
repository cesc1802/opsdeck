import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@/lib/bindings";
import { matchProjectByCwd, projectPickerEntries } from "./project-picker";

function project(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    project_id: "-Users-x-proj",
    name: "proj",
    path: "/Users/x/.claude/projects/-Users-x-proj",
    cwd: "/Users/x/proj",
    session_count: 1,
    active_count: 0,
    ...overrides,
  };
}

const PROJECTS: ProjectSummary[] = [
  project({ project_id: "a", name: "alpha", cwd: "/Users/x/alpha" }),
  project({ project_id: "b", name: "beta", cwd: "/Users/x/beta/" }),
  project({ project_id: "c", name: "gamma", cwd: null }),
];

describe("matchProjectByCwd", () => {
  it("returns the project whose cwd matches exactly", () => {
    expect(matchProjectByCwd(PROJECTS, "/Users/x/alpha")?.project_id).toBe(
      "a",
    );
  });

  it("returns null for a subdirectory of a known project", () => {
    expect(matchProjectByCwd(PROJECTS, "/Users/x/alpha/packages/core")).toBe(
      null,
    );
  });

  it("ignores trailing slashes on either side", () => {
    expect(matchProjectByCwd(PROJECTS, "/Users/x/alpha/")?.project_id).toBe(
      "a",
    );
    expect(matchProjectByCwd(PROJECTS, "/Users/x/beta")?.project_id).toBe(
      "b",
    );
  });

  it("never matches a project without a cwd", () => {
    expect(matchProjectByCwd(PROJECTS, "gamma")).toBe(null);
  });

  it("returns null for an empty cwd", () => {
    expect(matchProjectByCwd(PROJECTS, "")).toBe(null);
  });

  it("treats the root path as a path, not as empty", () => {
    const root = [project({ project_id: "r", name: "root", cwd: "/" })];
    expect(matchProjectByCwd(root, "/")?.project_id).toBe("r");
    expect(matchProjectByCwd(PROJECTS, "/")).toBe(null);
  });
});

describe("projectPickerEntries", () => {
  it("keeps backend order and disables projects without a cwd", () => {
    expect(projectPickerEntries(PROJECTS)).toEqual([
      {
        projectId: "a",
        name: "alpha",
        cwd: "/Users/x/alpha",
        disabled: false,
      },
      {
        projectId: "b",
        name: "beta",
        cwd: "/Users/x/beta/",
        disabled: false,
      },
      { projectId: "c", name: "gamma", cwd: null, disabled: true },
    ]);
  });

  it("returns no entries for an empty project list", () => {
    expect(projectPickerEntries([])).toEqual([]);
  });
});
