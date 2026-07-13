import type {
  JsonValue,
  Message,
  ModelPricing,
  PricingTable,
  TokenUsage,
} from "@/lib/bindings";

export type FileAction = "read" | "create" | "edit";

export interface FileArtifact {
  path: string;
  actions: FileAction[];
  added: number;
  removed: number;
  /** Index of the last message that touched this file (jump target). */
  lastMsgIndex: number;
}

export interface ChangeEntry {
  msgIndex: number;
  tool: string;
  path: string;
  /** Recorded content only (tool inputs) — never rebuilt from disk. */
  before: string | null;
  after: string | null;
}

export type AuditStatus = "ok" | "error" | "pending";

export interface AuditEntry {
  msgIndex: number;
  tool: string;
  target: string | null;
  timestamp: string | null;
  status: AuditStatus;
}

export interface TaskEntry {
  id: string | null;
  subject: string;
  status: string;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface InspectorData {
  files: FileArtifact[];
  changes: ChangeEntry[];
  audit: AuditEntry[];
  tasks: TaskEntry[];
  toolCounts: Record<string, number>;
  tokens: TokenUsage;
  cost: CostBreakdown;
}

/** Changes tab renders recorded before/after content clamped to this size. */
export const CHANGE_CLAMP_CHARS = 5000;

const FILE_TOOL_ACTIONS: Record<string, { action: FileAction; pathKey: string }> = {
  Read: { action: "read", pathKey: "file_path" },
  Write: { action: "create", pathKey: "file_path" },
  Edit: { action: "edit", pathKey: "file_path" },
  MultiEdit: { action: "edit", pathKey: "file_path" },
  NotebookEdit: { action: "edit", pathKey: "notebook_path" },
};

function asRecord(input: JsonValue): Record<string, JsonValue> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, JsonValue>;
  }
  return null;
}

function inputString(input: JsonValue, key: string): string | null {
  const record = asRecord(input);
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function lineCount(text: string | null): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function clamp(text: string | null): string | null {
  if (text === null) return null;
  return text.length > CHANGE_CLAMP_CHARS
    ? text.slice(0, CHANGE_CLAMP_CHARS) + "…"
    : text;
}

interface LineDelta {
  added: number;
  removed: number;
}

/**
 * Line stats from what the tool input recorded. MultiEdit sums its edits;
 * unknown shapes contribute zero rather than guessing.
 */
function lineDelta(tool: string, input: JsonValue): LineDelta {
  switch (tool) {
    case "Write":
      return { added: lineCount(inputString(input, "content")), removed: 0 };
    case "Edit":
      return {
        added: lineCount(inputString(input, "new_string")),
        removed: lineCount(inputString(input, "old_string")),
      };
    case "NotebookEdit":
      return {
        added: lineCount(inputString(input, "new_source")),
        removed: lineCount(inputString(input, "old_source")),
      };
    case "MultiEdit": {
      const edits = asRecord(input)?.edits;
      const delta: LineDelta = { added: 0, removed: 0 };
      if (Array.isArray(edits)) {
        for (const edit of edits) {
          delta.added += lineCount(inputString(edit, "new_string"));
          delta.removed += lineCount(inputString(edit, "old_string"));
        }
      }
      return delta;
    }
    default:
      return { added: 0, removed: 0 };
  }
}

/** Recorded before/after for the Changes tab; null when nothing was recorded. */
function changeContent(
  tool: string,
  input: JsonValue,
): { before: string | null; after: string | null } | null {
  switch (tool) {
    case "Write":
      return { before: null, after: inputString(input, "content") };
    case "Edit":
      return {
        before: inputString(input, "old_string"),
        after: inputString(input, "new_string"),
      };
    case "NotebookEdit":
      return {
        before: inputString(input, "old_source"),
        after: inputString(input, "new_source"),
      };
    case "MultiEdit": {
      const edits = asRecord(input)?.edits;
      if (!Array.isArray(edits)) return null;
      const befores: string[] = [];
      const afters: string[] = [];
      for (const edit of edits) {
        const before = inputString(edit, "old_string");
        const after = inputString(edit, "new_string");
        if (before !== null) befores.push(before);
        if (after !== null) afters.push(after);
      }
      return {
        before: befores.length > 0 ? befores.join("\n---\n") : null,
        after: afters.length > 0 ? afters.join("\n---\n") : null,
      };
    }
    default:
      return null;
  }
}

/** Short target shown in Audit rows: file path, command, pattern, etc. */
function auditTarget(tool: string, input: JsonValue): string | null {
  const fileTool = FILE_TOOL_ACTIONS[tool];
  if (fileTool) return inputString(input, fileTool.pathKey);
  for (const key of ["command", "pattern", "url", "query", "description", "skill"]) {
    const value = inputString(input, key);
    if (value) return value;
  }
  return null;
}

const TASK_ID_PATTERN = /#(\d+)/;

function deriveTasks(messages: Message[]): TaskEntry[] {
  const byId = new Map<string, TaskEntry>();
  const anonymous: TaskEntry[] = [];

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== "tool_use") continue;
      if (block.name === "TaskCreate") {
        const subject = inputString(block.input, "subject") ?? "";
        const id = block.result
          ? (TASK_ID_PATTERN.exec(block.result.content)?.[1] ?? null)
          : null;
        const entry: TaskEntry = { id, subject, status: "pending" };
        if (id) byId.set(id, entry);
        else anonymous.push(entry);
      } else if (block.name === "TaskUpdate") {
        const id = inputString(block.input, "taskId");
        if (!id) continue;
        const status = inputString(block.input, "status");
        const subject = inputString(block.input, "subject");
        const existing = byId.get(id);
        if (existing) {
          if (status) existing.status = status;
          if (subject) existing.subject = subject;
        } else {
          byId.set(id, {
            id,
            subject: subject ?? `#${id}`,
            status: status ?? "pending",
          });
        }
      }
    }
  }
  return [...byId.values(), ...anonymous];
}

function emptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

function rateFor(pricing: PricingTable, model: string | null): ModelPricing | null {
  const id = model ?? pricing.default_model_match;
  return (
    pricing.rates.find((rate) => id.includes(rate.model_match)) ??
    pricing.rates.find((rate) => rate.model_match === pricing.default_model_match) ??
    null
  );
}

/**
 * Streamed assistant chunks share a message_id and repeat cumulative usage,
 * so totals dedupe by message_id last-wins — the same rule the Rust meta
 * derivation applies, keeping the grid equal to the session-list numbers.
 */
function deriveTokensAndCost(
  messages: Message[],
  pricing: PricingTable | undefined,
): { tokens: TokenUsage; cost: CostBreakdown } {
  const byId = new Map<string, { usage: TokenUsage; model: string | null }>();
  const anonymous: { usage: TokenUsage; model: string | null }[] = [];
  for (const message of messages) {
    if (!message.usage) continue;
    const entry = { usage: message.usage, model: message.model };
    if (message.message_id) byId.set(message.message_id, entry);
    else anonymous.push(entry);
  }

  const tokens = emptyUsage();
  const cost: CostBreakdown = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  for (const { usage, model } of [...byId.values(), ...anonymous]) {
    tokens.input_tokens += usage.input_tokens;
    tokens.output_tokens += usage.output_tokens;
    tokens.cache_creation_input_tokens += usage.cache_creation_input_tokens;
    tokens.cache_read_input_tokens += usage.cache_read_input_tokens;
    const rate = pricing ? rateFor(pricing, model) : null;
    if (rate) {
      const M = 1_000_000;
      cost.input += (usage.input_tokens / M) * rate.input;
      cost.output += (usage.output_tokens / M) * rate.output;
      cost.cacheCreation +=
        (usage.cache_creation_input_tokens / M) * rate.cache_creation;
      cost.cacheRead += (usage.cache_read_input_tokens / M) * rate.cache_read;
    }
  }
  return { tokens, cost };
}

export function deriveInspector(
  messages: Message[],
  pricing: PricingTable | undefined,
): InspectorData {
  const files = new Map<string, FileArtifact>();
  const changes: ChangeEntry[] = [];
  const audit: AuditEntry[] = [];
  const toolCounts: Record<string, number> = {};

  messages.forEach((message, msgIndex) => {
    for (const block of message.blocks) {
      if (block.type !== "tool_use") continue;

      toolCounts[block.name] = (toolCounts[block.name] ?? 0) + 1;
      audit.push({
        msgIndex,
        tool: block.name,
        target: auditTarget(block.name, block.input),
        timestamp: message.timestamp,
        status: block.result ? (block.result.is_error ? "error" : "ok") : "pending",
      });

      const fileTool = FILE_TOOL_ACTIONS[block.name];
      if (!fileTool) continue;
      const path = inputString(block.input, fileTool.pathKey);
      if (!path) continue;

      const delta = lineDelta(block.name, block.input);
      const artifact = files.get(path);
      if (artifact) {
        if (!artifact.actions.includes(fileTool.action)) {
          artifact.actions.push(fileTool.action);
        }
        artifact.added += delta.added;
        artifact.removed += delta.removed;
        artifact.lastMsgIndex = msgIndex;
      } else {
        files.set(path, {
          path,
          actions: [fileTool.action],
          added: delta.added,
          removed: delta.removed,
          lastMsgIndex: msgIndex,
        });
      }

      const content = changeContent(block.name, block.input);
      if (content && (content.before !== null || content.after !== null)) {
        changes.push({
          msgIndex,
          tool: block.name,
          path,
          before: clamp(content.before),
          after: clamp(content.after),
        });
      }
    }
  });

  const { tokens, cost } = deriveTokensAndCost(messages, pricing);

  return {
    files: [...files.values()],
    changes,
    audit,
    tasks: deriveTasks(messages),
    toolCounts,
    tokens,
    cost,
  };
}
