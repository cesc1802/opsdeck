// Pure fold of the JobEvent stream into a renderable chat timeline. Replay
// and live tail arrive over the same channel; events are deduped by seq so a
// reattach mid-stream cannot duplicate or drop rows.
import type { Block, JobEvent, JsonValue, Message } from "@/lib/bindings";

export interface TurnInfo {
  subtype: string;
  is_error: boolean;
  cost_usd: number | null;
  usage: JsonValue | null;
  duration_ms: number | null;
  num_turns: number | null;
}

export type ChatItem =
  | { kind: "message"; message: Message }
  | { kind: "turn"; turn: TurnInfo }
  | { kind: "system"; tone: "notice" | "stderr" | "hook"; text: string }
  | { kind: "exit"; code: number | null };

export interface ChatTimeline {
  lastSeq: number;
  sessionId: string | null;
  model: string | null;
  cwd: string | null;
  tools: string[];
  items: ChatItem[];
  lastTurn: TurnInfo | null;
  /** An assistant message is currently receiving deltas. */
  streaming: boolean;
  exited: boolean;
  exitCode: number | null;
}

export function emptyTimeline(): ChatTimeline {
  return {
    lastSeq: -1,
    sessionId: null,
    model: null,
    cwd: null,
    tools: [],
    items: [],
    lastTurn: null,
    streaming: false,
    exited: false,
    exitCode: null,
  };
}

function message(role: string, model: string | null, blocks: Block[]): Message {
  return {
    uuid: null,
    message_id: null,
    role,
    timestamp: null,
    model,
    usage: null,
    blocks,
  };
}

/** The open assistant message, creating one if the last item isn't it. */
function openAssistant(draft: ChatTimeline): Message {
  const last = draft.items[draft.items.length - 1];
  if (draft.streaming && last?.kind === "message" && last.message.role === "assistant") {
    return last.message;
  }
  const next = message("assistant", draft.model, []);
  draft.items.push({ kind: "message", message: next });
  draft.streaming = true;
  return next;
}

function appendText(
  target: Message,
  key: "text" | "thinking",
  text: string,
): void {
  const last = target.blocks[target.blocks.length - 1];
  if (key === "text" && last?.type === "text") {
    last.text += text;
  } else if (key === "thinking" && last?.type === "thinking") {
    last.thinking += text;
  } else if (key === "text") {
    target.blocks.push({ type: "text", text });
  } else {
    target.blocks.push({ type: "thinking", thinking: text });
  }
}

function findToolBlock(
  draft: ChatTimeline,
  toolId: string,
): Extract<Block, { type: "tool_use" }> | null {
  // Search newest-first; tool results follow their tool_use closely.
  for (let i = draft.items.length - 1; i >= 0; i--) {
    const item = draft.items[i];
    if (item.kind !== "message") continue;
    for (const block of item.message.blocks) {
      if (block.type === "tool_use" && block.id === toolId) {
        return block;
      }
    }
  }
  return null;
}

function appendSystem(
  draft: ChatTimeline,
  tone: "notice" | "stderr" | "hook",
  text: string,
): void {
  const last = draft.items[draft.items.length - 1];
  // Coalesce consecutive stderr lines into one block to keep the list short.
  if (tone === "stderr" && last?.kind === "system" && last.tone === "stderr") {
    last.text += `\n${text}`;
    return;
  }
  draft.items.push({ kind: "system", tone, text });
}

function hookLabel(raw: JsonValue): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const name = raw.hook_event_name;
    if (typeof name === "string" && name) return name;
  }
  return "hook";
}

function applyEvent(draft: ChatTimeline, event: JobEvent): void {
  if (event.seq <= draft.lastSeq) {
    return;
  }
  draft.lastSeq = event.seq;
  const payload = event.payload;
  switch (payload.type) {
    case "sessionStarted":
      draft.sessionId = payload.data.session_id;
      draft.model = payload.data.model || draft.model;
      draft.cwd = payload.data.cwd || draft.cwd;
      draft.tools = payload.data.tools;
      break;
    case "userMessage":
      draft.streaming = false;
      draft.items.push({
        kind: "message",
        message: message("user", null, [
          { type: "text", text: payload.data.text },
        ]),
      });
      break;
    case "textDelta":
      appendText(openAssistant(draft), "text", payload.data.text);
      break;
    case "thinkingDelta":
      appendText(openAssistant(draft), "thinking", payload.data.text);
      break;
    case "toolUseStart":
      openAssistant(draft).blocks.push({
        type: "tool_use",
        id: payload.data.tool_id,
        name: payload.data.name,
        input: {},
        result: null,
      });
      break;
    case "toolUse": {
      const existing = findToolBlock(draft, payload.data.tool_id);
      if (existing) {
        existing.input = payload.data.input;
      } else {
        openAssistant(draft).blocks.push({
          type: "tool_use",
          id: payload.data.tool_id,
          name: payload.data.name,
          input: payload.data.input,
          result: null,
        });
      }
      break;
    }
    case "toolResult": {
      const block = findToolBlock(draft, payload.data.tool_id);
      if (block) {
        block.result = {
          is_error: payload.data.is_error,
          content: payload.data.content,
        };
      } else {
        draft.items.push({
          kind: "message",
          message: message("user", null, [
            {
              type: "tool_result",
              tool_use_id: payload.data.tool_id,
              is_error: payload.data.is_error,
              content: payload.data.content,
            },
          ]),
        });
      }
      break;
    }
    case "turnResult":
      draft.streaming = false;
      draft.lastTurn = payload.data;
      draft.items.push({ kind: "turn", turn: payload.data });
      break;
    case "hookEvent":
      appendSystem(draft, "hook", hookLabel(payload.data.raw));
      break;
    case "notice":
      appendSystem(draft, "notice", payload.data.message);
      break;
    case "stderr":
      appendSystem(draft, "stderr", payload.data.line);
      break;
    case "processExit":
      draft.streaming = false;
      draft.exited = true;
      draft.exitCode = payload.data.code;
      draft.items.push({ kind: "exit", code: payload.data.code });
      break;
  }
}

/**
 * Fold a batch of events into a new timeline. The previous timeline is not
 * mutated: items and open messages are cloned once per batch, so callers can
 * micro-batch high-frequency deltas and pay one clone per flush.
 */
export function reduceTimeline(
  previous: ChatTimeline,
  events: JobEvent[],
): ChatTimeline {
  if (events.length === 0) {
    return previous;
  }
  const draft: ChatTimeline = {
    ...previous,
    tools: [...previous.tools],
    items: previous.items.map((item) =>
      item.kind === "message"
        ? {
            kind: "message" as const,
            message: {
              ...item.message,
              blocks: item.message.blocks.map((block) => ({ ...block })),
            },
          }
        : { ...item },
    ),
  };
  for (const event of events) {
    applyEvent(draft, event);
  }
  return draft;
}
