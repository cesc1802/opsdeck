import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/bindings";
import { extractMessageText } from "./message-text";

function message(partial: Partial<Message>): Message {
  return {
    uuid: "u1",
    message_id: null,
    role: "assistant",
    timestamp: null,
    model: null,
    usage: null,
    blocks: [],
    ...partial,
  };
}

describe("extractMessageText", () => {
  it("collects text, thinking, and tool blocks", () => {
    const text = extractMessageText(
      message({
        blocks: [
          { type: "text", text: "hello **world**" },
          { type: "thinking", thinking: "pondering" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "ls /tmp" },
            result: { is_error: false, content: "total 0" },
          },
        ],
      }),
    );
    for (const expected of ["hello **world**", "pondering", "Bash", "ls /tmp", "total 0"]) {
      expect(text).toContain(expected);
    }
  });

  it("flattens user command tags into searchable text", () => {
    const text = extractMessageText(
      message({
        role: "user",
        blocks: [
          {
            type: "text",
            text: "<command-name>/cook</command-name><command-args>plan.md</command-args>",
          },
        ],
      }),
    );
    expect(text).toBe("/cook plan.md");
  });

  it("strips ANSI escapes from tool results", () => {
    const ESC = String.fromCharCode(0x1b);
    const text = extractMessageText(
      message({
        blocks: [
          {
            type: "tool_result",
            tool_use_id: "toolu_2",
            is_error: false,
            content: `${ESC}[31mfailed${ESC}[0m`,
          },
        ],
      }),
    );
    expect(text).toBe("failed");
  });
});
