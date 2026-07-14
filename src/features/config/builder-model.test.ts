import { describe, expect, it } from "vitest";
import type { HookRow } from "@/lib/bindings";
import {
  agentsJsonToRows,
  emptyAgentRow,
  emptyHookRow,
  hooksJsonToRows,
  rowsToAgentsJson,
  rowsToHooksJson,
  validateAgentRows,
  validateHookRows,
} from "./builder-model";

const EVENTS = ["PreToolUse", "PostToolUse", "Stop"];

describe("agent rows", () => {
  it("round-trips agents_json through rows", () => {
    const raw = JSON.stringify({
      helper: { description: "d", prompt: "p", model: "opus" },
      plain: { description: "d2", prompt: "p2" },
    });
    const rows = agentsJsonToRows(raw);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows![0]).toEqual({
      name: "helper",
      description: "d",
      model: "opus",
      prompt: "p",
    });

    const compiled = JSON.parse(rowsToAgentsJson(rows!)!);
    expect(compiled.helper.model).toBe("opus");
    expect(compiled.plain.model).toBeUndefined();
    expect(compiled.plain.prompt).toBe("p2");
  });

  it("returns null rows for unparseable or non-object json", () => {
    expect(agentsJsonToRows("not json")).toBeNull();
    expect(agentsJsonToRows("[1,2]")).toBeNull();
  });

  it("maps empty input to no rows and no rows to null json", () => {
    expect(agentsJsonToRows(null)).toEqual([]);
    expect(agentsJsonToRows("  ")).toEqual([]);
    expect(rowsToAgentsJson([])).toBeNull();
  });

  it("flags missing fields and duplicate names per row", () => {
    const rows = [
      { name: "a", description: "d", model: "", prompt: "p" },
      { name: "", description: "d", model: "", prompt: "p" },
      { name: "a", description: "d", model: "", prompt: "p" },
      { name: "b", description: "", model: "", prompt: "p" },
      { name: "c", description: "d", model: "", prompt: " " },
    ];
    const errors = validateAgentRows(rows);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBe("name is required");
    expect(errors[2]).toBe("duplicate name");
    expect(errors[3]).toBe("description is required");
    expect(errors[4]).toBe("prompt is required");
  });

  it("starts with a blank row template", () => {
    expect(emptyAgentRow()).toEqual({
      name: "",
      description: "",
      model: "",
      prompt: "",
    });
  });
});

describe("hook rows", () => {
  const row = (overrides: Partial<HookRow>): HookRow => ({
    event: "PreToolUse",
    matcher: null,
    command: "echo hi",
    timeout: 30,
    enabled: true,
    ...overrides,
  });

  it("round-trips hooks_json including disabled rows", () => {
    const rows = [row({}), row({ event: "Stop", enabled: false })];
    const raw = rowsToHooksJson(rows)!;
    expect(hooksJsonToRows(raw)).toEqual(rows);
  });

  it("normalizes blank matchers to null and bad shapes to safe defaults", () => {
    const parsed = hooksJsonToRows(
      JSON.stringify([{ event: "Stop", matcher: " ", command: "c" }]),
    );
    expect(parsed![0].matcher).toBeNull();
    expect(parsed![0].timeout).toBe(0);
    expect(parsed![0].enabled).toBe(true);
  });

  it("returns null for unparseable or non-array json", () => {
    expect(hooksJsonToRows("nope")).toBeNull();
    expect(hooksJsonToRows("{}")).toBeNull();
    expect(hooksJsonToRows(null)).toEqual([]);
    expect(rowsToHooksJson([])).toBeNull();
  });

  it("flags unknown events, empty commands, and bad timeouts", () => {
    const errors = validateHookRows(
      [
        row({}),
        row({ event: "NotAnEvent" }),
        row({ command: "  " }),
        row({ timeout: 0 }),
        row({ timeout: -5 }),
      ],
      EVENTS,
    );
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBe("unknown event");
    expect(errors[2]).toBe("command is required");
    expect(errors[3]).toBe("timeout must be > 0");
    expect(errors[4]).toBe("timeout must be > 0");
  });

  it("seeds new rows with the first known event and a sane timeout", () => {
    expect(emptyHookRow(EVENTS)).toEqual({
      event: "PreToolUse",
      matcher: null,
      command: "",
      timeout: 30,
      enabled: true,
    });
  });
});
