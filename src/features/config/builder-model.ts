// Pure row <-> JSON mapping and validation for the agent/hook builders.
// Mirrors the backend classes in `validate_options` (agents need name,
// description, prompt; hook rows need a known event, a command, timeout > 0)
// so inline errors match what the CLI launch would reject.
import type { HookRow } from "@/lib/bindings";
import { t } from "@/lib/i18n";

export interface AgentRow {
  name: string;
  description: string;
  model: string;
  prompt: string;
}

export function emptyAgentRow(): AgentRow {
  return { name: "", description: "", model: "", prompt: "" };
}

/** Parse `LaunchOptions.agents_json` into rows; null when unparseable. */
export function agentsJsonToRows(raw: string | null): AgentRow[] | null {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return Object.entries(parsed as Record<string, unknown>).map(
      ([name, value]) => {
        const agent =
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        const text = (key: string) =>
          typeof agent[key] === "string" ? (agent[key] as string) : "";
        return {
          name,
          description: text("description"),
          model: text("model"),
          prompt: text("prompt"),
        };
      },
    );
  } catch {
    return null;
  }
}

/** Compile rows back into the agents payload; null when there are no rows. */
export function rowsToAgentsJson(rows: AgentRow[]): string | null {
  if (rows.length === 0) return null;
  const agents: Record<
    string,
    { description: string; prompt: string; model?: string }
  > = {};
  for (const row of rows) {
    agents[row.name.trim()] = {
      description: row.description.trim(),
      prompt: row.prompt.trim(),
      ...(row.model.trim() ? { model: row.model.trim() } : {}),
    };
  }
  return JSON.stringify(agents, null, 2);
}

/** Row index -> first error message; empty object means all rows are valid. */
export function validateAgentRows(rows: AgentRow[]): Record<number, string> {
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = row.name.trim();
    if (!name) {
      errors[index] = t("config.builder.nameRequired");
    } else if (seen.has(name)) {
      errors[index] = t("config.builder.duplicateName");
    } else if (!row.description.trim()) {
      errors[index] = t("config.builder.descriptionRequired");
    } else if (!row.prompt.trim()) {
      errors[index] = t("config.builder.promptRequired");
    }
    seen.add(name);
  });
  return errors;
}

export function emptyHookRow(events: string[]): HookRow {
  return {
    event: events[0] ?? "",
    matcher: null,
    command: "",
    timeout: 30,
    enabled: true,
  };
}

/** Parse `LaunchOptions.hooks_json` into rows; null when unparseable. */
export function hooksJsonToRows(raw: string | null): HookRow[] | null {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((value) => {
      const row =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        event: typeof row.event === "string" ? row.event : "",
        matcher:
          typeof row.matcher === "string" && row.matcher.trim()
            ? row.matcher
            : null,
        command: typeof row.command === "string" ? row.command : "",
        timeout: typeof row.timeout === "number" ? row.timeout : 0,
        enabled: typeof row.enabled === "boolean" ? row.enabled : true,
      };
    });
  } catch {
    return null;
  }
}

/** Compile rows (including disabled ones — the backend excludes them at
 * launch) back into `hooks_json`; null when there are no rows. */
export function rowsToHooksJson(rows: HookRow[]): string | null {
  if (rows.length === 0) return null;
  return JSON.stringify(rows, null, 2);
}

export function validateHookRows(
  rows: HookRow[],
  knownEvents: string[],
): Record<number, string> {
  const errors: Record<number, string> = {};
  rows.forEach((row, index) => {
    if (!knownEvents.includes(row.event)) {
      errors[index] = t("config.builder.eventUnknown");
    } else if (!row.command.trim()) {
      errors[index] = t("config.builder.commandRequired");
    } else if (!(row.timeout > 0)) {
      errors[index] = t("config.builder.timeoutPositive");
    }
  });
  return errors;
}
