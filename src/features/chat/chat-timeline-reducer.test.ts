import { describe, expect, it } from "vitest";
import type { JobEvent, JobEventPayload } from "@/lib/bindings";
import {
  emptyTimeline,
  reduceTimeline,
  type ChatItem,
} from "./chat-timeline-reducer";

let seq = 0;
function ev(payload: JobEventPayload): JobEvent {
  return { seq: seq++, payload };
}

function conversation(): JobEvent[] {
  seq = 0;
  return [
    ev({
      type: "sessionStarted",
      data: {
        session_id: "ses_1",
        model: "claude-sonnet-5",
        cwd: "/tmp/demo",
        tools: ["Bash", "Read"],
        slash_commands: ["compact", "cook"],
        agents: ["code-reviewer"],
      },
    }),
    ev({ type: "userMessage", data: { text: "list the files" } }),
    ev({ type: "thinkingDelta", data: { text: "Let me look." } }),
    ev({ type: "textDelta", data: { text: "I'll list " } }),
    ev({ type: "textDelta", data: { text: "the directory." } }),
    ev({ type: "toolUseStart", data: { tool_id: "t1", name: "Bash" } }),
    ev({
      type: "toolUse",
      data: { tool_id: "t1", name: "Bash", input: { command: "ls" } },
    }),
    ev({
      type: "toolResult",
      data: { tool_id: "t1", is_error: false, content: "file-a\nfile-b" },
    }),
    ev({
      type: "turnResult",
      data: {
        subtype: "success",
        is_error: false,
        cost_usd: 0.04,
        usage: { output_tokens: 10 },
        duration_ms: 1200,
        num_turns: 2,
      },
    }),
  ];
}

function kinds(items: ChatItem[]): string[] {
  return items.map((item) =>
    item.kind === "message" ? `message:${item.message.role}` : item.kind,
  );
}

describe("reduceTimeline", () => {
  it("folds a full turn into user + assistant + turn rows", () => {
    const timeline = reduceTimeline(emptyTimeline(), conversation());

    expect(timeline.sessionId).toBe("ses_1");
    expect(timeline.model).toBe("claude-sonnet-5");
    expect(timeline.cwd).toBe("/tmp/demo");
    expect(timeline.completions).toEqual({
      slashCommands: ["compact", "cook"],
      agents: ["code-reviewer"],
    });
    expect(kinds(timeline.items)).toEqual([
      "message:user",
      "message:assistant",
      "turn",
    ]);

    const assistant = timeline.items[1];
    if (assistant.kind !== "message") throw new Error("expected message");
    expect(assistant.message.blocks).toEqual([
      { type: "thinking", thinking: "Let me look." },
      { type: "text", text: "I'll list the directory." },
      {
        type: "tool_use",
        id: "t1",
        name: "Bash",
        input: { command: "ls" },
        result: { is_error: false, content: "file-a\nfile-b" },
      },
    ]);
    expect(timeline.lastTurn?.cost_usd).toBe(0.04);
    expect(timeline.streaming).toBe(false);
  });

  it("is incremental: event-at-a-time equals one batch", () => {
    const events = conversation();
    const batched = reduceTimeline(emptyTimeline(), events);
    const stepped = events.reduce(
      (timeline, event) => reduceTimeline(timeline, [event]),
      emptyTimeline(),
    );
    expect(stepped).toEqual(batched);
  });

  it("dedupes replayed events by seq", () => {
    const events = conversation();
    const once = reduceTimeline(emptyTimeline(), events);
    // Replay the full buffer again (reattach), then a fresh live event.
    seq = events.length;
    const live = ev({ type: "textDelta", data: { text: "More." } });
    const twice = reduceTimeline(once, [...events, live]);

    expect(kinds(twice.items)).toEqual([
      "message:user",
      "message:assistant",
      "turn",
      "message:assistant",
    ]);
    expect(twice.lastSeq).toBe(live.seq);
  });

  it("opens a fresh assistant message after a follow-up", () => {
    const events = conversation();
    seq = events.length;
    events.push(
      ev({ type: "userMessage", data: { text: "and hidden files?" } }),
      ev({ type: "textDelta", data: { text: "Sure." } }),
    );
    const timeline = reduceTimeline(emptyTimeline(), events);
    expect(kinds(timeline.items)).toEqual([
      "message:user",
      "message:assistant",
      "turn",
      "message:user",
      "message:assistant",
    ]);
    expect(timeline.streaming).toBe(true);
  });

  it("keeps an unmatched tool result as an unpaired row", () => {
    seq = 0;
    const timeline = reduceTimeline(emptyTimeline(), [
      ev({
        type: "toolResult",
        data: { tool_id: "ghost", is_error: true, content: "boom" },
      }),
    ]);
    const item = timeline.items[0];
    if (item.kind !== "message") throw new Error("expected message");
    expect(item.message.blocks[0]).toEqual({
      type: "tool_result",
      tool_use_id: "ghost",
      is_error: true,
      content: "boom",
    });
  });

  it("coalesces consecutive stderr lines and records exit", () => {
    seq = 0;
    const timeline = reduceTimeline(emptyTimeline(), [
      ev({ type: "stderr", data: { line: "warn one" } }),
      ev({ type: "stderr", data: { line: "warn two" } }),
      ev({ type: "notice", data: { message: "note" } }),
      ev({ type: "processExit", data: { code: 1 } }),
    ]);
    expect(timeline.items).toEqual([
      { kind: "system", tone: "stderr", text: "warn one\nwarn two" },
      { kind: "system", tone: "notice", text: "note" },
      { kind: "exit", code: 1 },
    ]);
    expect(timeline.exited).toBe(true);
    expect(timeline.exitCode).toBe(1);
  });

  it("interrupt mid-stream: exit closes the open assistant message", () => {
    seq = 0;
    const timeline = reduceTimeline(emptyTimeline(), [
      ev({ type: "userMessage", data: { text: "go" } }),
      ev({ type: "textDelta", data: { text: "Working…" } }),
      ev({ type: "processExit", data: { code: null } }),
    ]);
    expect(timeline.streaming).toBe(false);
    expect(kinds(timeline.items)).toEqual([
      "message:user",
      "message:assistant",
      "exit",
    ]);
  });

  it("does not mutate the previous timeline", () => {
    const events = conversation();
    const first = reduceTimeline(emptyTimeline(), events.slice(0, 4));
    const snapshot = JSON.parse(JSON.stringify(first));
    reduceTimeline(first, events.slice(4));
    expect(first).toEqual(snapshot);
  });
});
