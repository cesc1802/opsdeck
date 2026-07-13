import { describe, expect, it } from "vitest";
import { toolMeta } from "./tool-meta";

describe("toolMeta", () => {
  it("extracts the file path target for file tools", () => {
    expect(toolMeta("Read").target({ file_path: "/tmp/a.txt" })).toBe(
      "/tmp/a.txt",
    );
    expect(toolMeta("Edit").target({ file_path: "/src/x.ts" })).toBe(
      "/src/x.ts",
    );
  });

  it("extracts the command for Bash", () => {
    expect(toolMeta("Bash").target({ command: "ls -la" })).toBe("ls -la");
  });

  it("falls back through preference-ordered keys", () => {
    expect(toolMeta("Task").target({ prompt: "long prompt" })).toBe(
      "long prompt",
    );
    expect(
      toolMeta("Task").target({ description: "short", prompt: "long" }),
    ).toBe("short");
  });

  it("returns a default for unknown tools and non-object input", () => {
    const meta = toolMeta("SomeMcpTool");
    expect(meta.icon).toBeDefined();
    expect(meta.target({ anything: "x" })).toBeNull();
    expect(toolMeta("Read").target("not an object")).toBeNull();
    expect(toolMeta("Read").target(null)).toBeNull();
  });
});
