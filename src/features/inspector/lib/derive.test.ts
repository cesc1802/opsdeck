import { describe, expect, it } from "vitest";
import type { Block, JsonValue, Message, PricingTable } from "@/lib/bindings";
import { CHANGE_CLAMP_CHARS, deriveInspector } from "./derive";

function message(partial: Partial<Message>): Message {
  return {
    uuid: null,
    message_id: null,
    role: "assistant",
    timestamp: null,
    model: null,
    usage: null,
    blocks: [],
    ...partial,
  };
}

function toolUse(
  name: string,
  input: JsonValue,
  result: { is_error: boolean; content: string } | null = {
    is_error: false,
    content: "ok",
  },
): Block {
  return { type: "tool_use", id: "toolu_x", name, input, result };
}

const PRICING: PricingTable = {
  rates: [
    {
      model_match: "sonnet",
      input: 3,
      output: 15,
      cache_creation: 3.75,
      cache_read: 0.3,
    },
  ],
  default_model_match: "sonnet",
  disclaimer: "estimated",
};

describe("deriveInspector files", () => {
  it("dedupes by path, merges actions, and counts edit lines", () => {
    const data = deriveInspector(
      [
        message({ blocks: [toolUse("Read", { file_path: "/a.ts" })] }),
        message({
          blocks: [
            toolUse("Edit", {
              file_path: "/a.ts",
              old_string: "one\ntwo",
              new_string: "one\ntwo\nthree",
            }),
          ],
        }),
        message({
          blocks: [toolUse("Write", { file_path: "/b.ts", content: "x\ny" })],
        }),
      ],
      PRICING,
    );
    expect(data.files).toHaveLength(2);
    const a = data.files.find((f) => f.path === "/a.ts")!;
    expect(a.actions).toEqual(["read", "edit"]);
    expect(a.added).toBe(3);
    expect(a.removed).toBe(2);
    expect(a.lastMsgIndex).toBe(1);
    const b = data.files.find((f) => f.path === "/b.ts")!;
    expect(b.actions).toEqual(["create"]);
    expect(b.added).toBe(2);
  });

  it("sums MultiEdit edits", () => {
    const data = deriveInspector(
      [
        message({
          blocks: [
            toolUse("MultiEdit", {
              file_path: "/c.ts",
              edits: [
                { old_string: "a", new_string: "a\nb" },
                { old_string: "x\ny", new_string: "z" },
              ],
            }),
          ],
        }),
      ],
      PRICING,
    );
    expect(data.files[0].added).toBe(3);
    expect(data.files[0].removed).toBe(3);
  });
});

describe("deriveInspector changes", () => {
  it("records edits only from tool inputs and clamps long content", () => {
    const long = "x".repeat(CHANGE_CLAMP_CHARS + 100);
    const data = deriveInspector(
      [
        message({
          blocks: [
            toolUse("Read", { file_path: "/a.ts" }),
            toolUse("Write", { file_path: "/b.ts", content: long }),
          ],
        }),
      ],
      PRICING,
    );
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0].tool).toBe("Write");
    expect(data.changes[0].before).toBeNull();
    expect(data.changes[0].after!.length).toBe(CHANGE_CLAMP_CHARS + 1);
  });
});

describe("deriveInspector audit", () => {
  it("captures every tool_use with status from its result", () => {
    const data = deriveInspector(
      [
        message({
          timestamp: "2026-07-13T10:00:00Z",
          blocks: [
            toolUse("Bash", { command: "ls" }),
            toolUse("Grep", { pattern: "todo" }, { is_error: true, content: "boom" }),
            toolUse("Skill", { skill: "cook" }, null),
          ],
        }),
      ],
      PRICING,
    );
    expect(data.audit).toHaveLength(3);
    expect(data.audit[0]).toMatchObject({
      tool: "Bash",
      target: "ls",
      status: "ok",
      timestamp: "2026-07-13T10:00:00Z",
    });
    expect(data.audit[1].status).toBe("error");
    expect(data.audit[2].status).toBe("pending");
    expect(data.toolCounts).toEqual({ Bash: 1, Grep: 1, Skill: 1 });
  });
});

describe("deriveInspector tasks", () => {
  it("links TaskCreate results to TaskUpdate statuses by id", () => {
    const data = deriveInspector(
      [
        message({
          blocks: [
            toolUse(
              "TaskCreate",
              { subject: "Ship feature" },
              { is_error: false, content: "Created task #7" },
            ),
          ],
        }),
        message({
          blocks: [toolUse("TaskUpdate", { taskId: "7", status: "completed" })],
        }),
      ],
      PRICING,
    );
    expect(data.tasks).toEqual([
      { id: "7", subject: "Ship feature", status: "completed" },
    ]);
  });
});

describe("deriveInspector tokens and cost", () => {
  it("dedupes streamed chunks by message_id last-wins", () => {
    const data = deriveInspector(
      [
        message({
          message_id: "msg_1",
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
        message({
          message_id: "msg_1",
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 10,
            output_tokens: 60,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 1_000_000,
          },
        }),
      ],
      PRICING,
    );
    expect(data.tokens.output_tokens).toBe(60);
    expect(data.tokens.input_tokens).toBe(10);
    expect(data.tokens.cache_read_input_tokens).toBe(1_000_000);
    // 10/1M*3 + 60/1M*15 + 1M/1M*0.3 = 0.00003 + 0.0009 + 0.3
    expect(
      data.cost.input + data.cost.output + data.cost.cacheCreation + data.cost.cacheRead,
    ).toBeCloseTo(0.30093, 6);
  });
});
