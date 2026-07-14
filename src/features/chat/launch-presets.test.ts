import { describe, expect, it } from "vitest";
import type { PermissionPreset } from "@/lib/bindings";
import {
  applyPreset,
  defaultLaunchOptions,
  groupFieldErrors,
  listToText,
  matchPresetId,
  textToList,
} from "./launch-presets";

const PRESETS: PermissionPreset[] = [
  {
    id: "safe",
    label: "Safe",
    permission_mode: "manual",
    disallowed_tools: ["Bash(rm *)", "Bash(git push *)"],
  },
  {
    id: "standard",
    label: "Standard",
    permission_mode: "acceptEdits",
    disallowed_tools: [],
  },
  { id: "auto", label: "Auto", permission_mode: "auto", disallowed_tools: [] },
  { id: "plan", label: "Plan", permission_mode: "plan", disallowed_tools: [] },
];

describe("defaultLaunchOptions", () => {
  it("starts on the standard preset", () => {
    expect(matchPresetId(defaultLaunchOptions(), PRESETS)).toBe("standard");
  });
});

describe("applyPreset / matchPresetId", () => {
  it("round-trips every preset", () => {
    for (const preset of PRESETS) {
      const applied = applyPreset(defaultLaunchOptions(), preset);
      expect(matchPresetId(applied, PRESETS)).toBe(preset.id);
    }
  });

  it("copies the disallowed tools instead of sharing the array", () => {
    const applied = applyPreset(defaultLaunchOptions(), PRESETS[0]);
    applied.disallowed_tools.push("Bash(sudo *)");
    expect(PRESETS[0].disallowed_tools).toHaveLength(2);
  });

  it("returns null once options drift from every preset", () => {
    const custom = {
      ...applyPreset(defaultLaunchOptions(), PRESETS[1]),
      permission_mode: "bypassPermissions",
    };
    expect(matchPresetId(custom, PRESETS)).toBeNull();

    const extraDenied = {
      ...applyPreset(defaultLaunchOptions(), PRESETS[0]),
      disallowed_tools: ["Bash(rm *)"],
    };
    expect(matchPresetId(extraDenied, PRESETS)).toBeNull();
  });
});

describe("list field coercion", () => {
  it("splits on commas and newlines, trims, drops empties", () => {
    expect(textToList("Bash, Read\n\n  Edit ,\nWrite")).toEqual([
      "Bash",
      "Read",
      "Edit",
      "Write",
    ]);
    expect(textToList("")).toEqual([]);
    expect(textToList(" , ,\n")).toEqual([]);
  });

  it("round-trips display text through the parser", () => {
    const items = ["Bash(rm *)", "mcp__server__tool", "Read"];
    expect(textToList(listToText(items))).toEqual(items);
  });
});

describe("groupFieldErrors", () => {
  it("keeps the first message per field", () => {
    expect(
      groupFieldErrors([
        { field: "cwd", message: "working directory is required" },
        { field: "cwd", message: "directory does not exist" },
        { field: "prompt", message: "prompt is required" },
      ]),
    ).toEqual({
      cwd: "working directory is required",
      prompt: "prompt is required",
    });
  });

  it("returns an empty object for no errors", () => {
    expect(groupFieldErrors([])).toEqual({});
  });
});
