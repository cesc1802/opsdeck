import { describe, expect, it } from "vitest";
import type { ProjectStats } from "@/lib/bindings";
import { barWidth, formatShare, sortProjects } from "./stats-model";

function project(overrides: Partial<ProjectStats>): ProjectStats {
  return {
    project_id: "p",
    name: "project",
    session_count: 1,
    message_count: 10,
    total_tokens: 100,
    estimated_cost_usd: 0.5,
    ...overrides,
  };
}

describe("sortProjects", () => {
  const rows = [
    project({ project_id: "a", name: "alpha", total_tokens: 100 }),
    project({ project_id: "c", name: "charlie", total_tokens: 300 }),
    project({ project_id: "b", name: "bravo", total_tokens: 200 }),
  ];

  it("sorts by tokens descending by default", () => {
    const sorted = sortProjects(rows, "total_tokens", true);
    expect(sorted.map((r) => r.name)).toEqual(["charlie", "bravo", "alpha"]);
  });

  it("sorts by name ascending", () => {
    const sorted = sortProjects(rows, "name", false);
    expect(sorted.map((r) => r.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("breaks numeric ties by name so order is stable", () => {
    const tied = [
      project({ project_id: "z", name: "zulu", total_tokens: 100 }),
      project({ project_id: "a", name: "alpha", total_tokens: 100 }),
      project({ project_id: "m", name: "mike", total_tokens: 100 }),
    ];
    const sorted = sortProjects(tied, "total_tokens", true);
    expect(sorted.map((r) => r.name)).toEqual(["alpha", "mike", "zulu"]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortProjects(input, "total_tokens", true);
    expect(input.map((r) => r.name)).toEqual(["alpha", "charlie", "bravo"]);
  });

  it("sorts by cost and messages too", () => {
    const mixed = [
      project({ name: "cheap", estimated_cost_usd: 0.1, message_count: 5 }),
      project({ name: "pricey", estimated_cost_usd: 2.4, message_count: 50 }),
    ];
    expect(sortProjects(mixed, "estimated_cost_usd", true)[0].name).toBe(
      "pricey",
    );
    expect(sortProjects(mixed, "message_count", false)[0].name).toBe("cheap");
  });
});

describe("formatShare", () => {
  it("returns 0% for zero or negative shares", () => {
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(-0.2)).toBe("0%");
  });

  it("keeps sub-1% shares visible instead of rounding to 0%", () => {
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(0.0099)).toBe("<1%");
  });

  it("rounds ordinary shares to whole percents", () => {
    expect(formatShare(0.01)).toBe("1%");
    expect(formatShare(0.336)).toBe("34%");
    expect(formatShare(1)).toBe("100%");
  });
});

describe("barWidth", () => {
  it("is 0 when the value or max is zero", () => {
    expect(barWidth(0, 100)).toBe(0);
    expect(barWidth(50, 0)).toBe(0);
  });

  it("keeps tiny values visible at 1%", () => {
    expect(barWidth(1, 10_000)).toBe(1);
  });

  it("scales to 100 for the largest row", () => {
    expect(barWidth(100, 100)).toBe(100);
    expect(barWidth(50, 100)).toBe(50);
  });
});
