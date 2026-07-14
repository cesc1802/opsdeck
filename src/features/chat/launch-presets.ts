// Pure form-model helpers for the New Chat form: defaults, permission preset
// application, list-field text coercion, and field-error grouping. Kept free
// of React so the mapping logic is unit-testable.
import type { FieldError, LaunchOptions, PermissionPreset } from "@/lib/bindings";
import type { I18nKey } from "@/lib/i18n";

export function defaultLaunchOptions(): LaunchOptions {
  return {
    name: null,
    cwd: "",
    prompt: "",
    model: null,
    effort: null,
    // Matches the "standard" preset served by get_chat_config.
    permission_mode: "acceptEdits",
    max_budget_usd: null,
    worktree: false,
    worktree_name: null,
    resume_session_id: null,
    fork_session: false,
    allowed_tools: [],
    disallowed_tools: [],
    mcp_configs: [],
    strict_mcp_config: false,
    plugin_dirs: [],
    agents_json: null,
    hooks_json: null,
    setting_sources: [],
    append_system_prompt: null,
    settings_json: null,
  };
}

export function applyPreset(
  options: LaunchOptions,
  preset: PermissionPreset,
): LaunchOptions {
  return {
    ...options,
    permission_mode: preset.permission_mode,
    disallowed_tools: [...preset.disallowed_tools],
  };
}

/** Preset whose mode and tool denials match the current options, if any. */
export function matchPresetId(
  options: LaunchOptions,
  presets: PermissionPreset[],
): string | null {
  const match = presets.find(
    (preset) =>
      preset.permission_mode === options.permission_mode &&
      preset.disallowed_tools.length === options.disallowed_tools.length &&
      preset.disallowed_tools.every(
        (tool, i) => options.disallowed_tools[i] === tool,
      ),
  );
  return match ? match.id : null;
}

export const PRESET_DESCRIPTION_KEYS: Record<string, I18nKey> = {
  safe: "chat.preset.safe.desc",
  standard: "chat.preset.standard.desc",
  auto: "chat.preset.auto.desc",
  plan: "chat.preset.plan.desc",
};

/** Display form of a list field: one entry per line. */
export function listToText(items: string[]): string {
  return items.join("\n");
}

/** Parse a list field: comma or newline separated, trimmed, empties dropped. */
export function textToList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** First message per field wins; the backend already orders by severity. */
export function groupFieldErrors(
  errors: FieldError[],
): Record<string, string> {
  const grouped: Record<string, string> = {};
  for (const error of errors) {
    if (!(error.field in grouped)) {
      grouped[error.field] = error.message;
    }
  }
  return grouped;
}
