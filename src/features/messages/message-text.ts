import type { Message } from "@/lib/bindings";
import { stripAnsi } from "@/lib/ansi";
import { parseUserText } from "@/lib/command-tags";

function segmentText(raw: string): string {
  return parseUserText(raw)
    .map((segment) =>
      segment.kind === "command"
        ? `${segment.name} ${segment.args}`.trim()
        : segment.text,
    )
    .join("\n");
}

/**
 * Plain text a message contributes to find-in-session and copy: visible
 * text, thinking, tool names/targets, and tool result contents.
 */
export function extractMessageText(message: Message): string {
  const parts: string[] = [];
  for (const block of message.blocks) {
    switch (block.type) {
      case "text":
        parts.push(
          message.role === "user" ? segmentText(block.text) : block.text,
        );
        break;
      case "thinking":
        parts.push(block.thinking);
        break;
      case "tool_use":
        parts.push(block.name);
        parts.push(JSON.stringify(block.input));
        if (block.result) parts.push(stripAnsi(block.result.content));
        break;
      case "tool_result":
        parts.push(stripAnsi(block.content));
        break;
    }
  }
  return parts.filter(Boolean).join("\n");
}
