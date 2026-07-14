use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
/// UI vocabulary; `manual` maps to the CLI's `default` mode in `build_args`.
pub const PERMISSION_MODES: [&str; 6] = [
    "acceptEdits",
    "auto",
    "bypassPermissions",
    "manual",
    "dontAsk",
    "plan",
];
pub const SETTING_SOURCES: [&str; 3] = ["user", "project", "local"];
pub const HOOK_EVENTS: [&str; 8] = [
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "Stop",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
];

const NAME_CLAMP: usize = 120;
const MAX_BUDGET_USD: f64 = 100_000.0;

/// Wire contract between the New Chat form, saved profiles, and the job
/// engine. All fields optional except cwd + prompt; lists tolerate comma or
/// newline separated single entries (normalized before validation).
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "snake_case")]
pub struct LaunchOptions {
    pub name: Option<String>,
    pub cwd: String,
    /// First user message, sent over stdin after spawn (never a CLI arg).
    pub prompt: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub worktree: bool,
    pub worktree_name: Option<String>,
    pub resume_session_id: Option<String>,
    pub fork_session: bool,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub mcp_configs: Vec<String>,
    pub strict_mcp_config: bool,
    pub plugin_dirs: Vec<String>,
    /// JSON object: agent name -> { description, prompt, ... }.
    pub agents_json: Option<String>,
    /// JSON array of hook rows: { event, matcher?, command, timeout, enabled }.
    pub hooks_json: Option<String>,
    pub setting_sources: Vec<String>,
    pub append_system_prompt: Option<String>,
    /// Raw settings JSON object (power-user escape hatch), merged with hooks
    /// into the temp `--settings` file.
    pub settings_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PermissionPreset {
    pub id: String,
    pub label: String,
    pub permission_mode: String,
    pub disallowed_tools: Vec<String>,
}

/// Static vocabulary served to the UI so form options never drift from the
/// backend validators.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChatConfig {
    pub model_suggestions: Vec<String>,
    pub efforts: Vec<String>,
    pub permission_modes: Vec<String>,
    pub setting_sources: Vec<String>,
    pub hook_events: Vec<String>,
    pub presets: Vec<PermissionPreset>,
}

pub fn chat_config() -> ChatConfig {
    ChatConfig {
        model_suggestions: vec!["opus".into(), "sonnet".into(), "haiku".into()],
        efforts: EFFORTS.iter().map(|s| s.to_string()).collect(),
        permission_modes: PERMISSION_MODES.iter().map(|s| s.to_string()).collect(),
        setting_sources: SETTING_SOURCES.iter().map(|s| s.to_string()).collect(),
        hook_events: HOOK_EVENTS.iter().map(|s| s.to_string()).collect(),
        presets: vec![
            PermissionPreset {
                id: "safe".into(),
                label: "Safe".into(),
                permission_mode: "manual".into(),
                disallowed_tools: vec!["Bash(rm *)".into(), "Bash(git push *)".into()],
            },
            PermissionPreset {
                id: "standard".into(),
                label: "Standard".into(),
                permission_mode: "acceptEdits".into(),
                disallowed_tools: vec![],
            },
            PermissionPreset {
                id: "auto".into(),
                label: "Auto".into(),
                permission_mode: "auto".into(),
                disallowed_tools: vec![],
            },
            PermissionPreset {
                id: "plan".into(),
                label: "Plan".into(),
                permission_mode: "plan".into(),
                disallowed_tools: vec![],
            },
        ],
    }
}

pub fn expand_path(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn clamp_len(value: &mut String) {
    if value.chars().count() > NAME_CLAMP {
        *value = value.chars().take(NAME_CLAMP).collect();
    }
}

/// Split list entries on commas/newlines, trim, drop empties. Lets the UI
/// pass a single pasted string per list field.
fn coerce_list(list: &mut Vec<String>) {
    *list = list
        .iter()
        .flat_map(|entry| entry.split([',', '\n']))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
}

pub fn normalize_options(options: &mut LaunchOptions) {
    if let Some(name) = &mut options.name {
        *name = name.trim().to_string();
        clamp_len(name);
        if name.is_empty() {
            options.name = None;
        }
    }
    options.cwd = options.cwd.trim().to_string();
    if let Some(model) = &mut options.model {
        *model = model.trim().to_string();
        clamp_len(model);
        if model.is_empty() {
            options.model = None;
        }
    }
    for field in [
        &mut options.effort,
        &mut options.permission_mode,
        &mut options.resume_session_id,
        &mut options.worktree_name,
    ] {
        if let Some(value) = field {
            *value = value.trim().to_string();
            clamp_len(value);
            if value.is_empty() {
                *field = None;
            }
        }
    }
    coerce_list(&mut options.allowed_tools);
    coerce_list(&mut options.disallowed_tools);
    coerce_list(&mut options.mcp_configs);
    coerce_list(&mut options.plugin_dirs);
    coerce_list(&mut options.setting_sources);
}

fn err(errors: &mut Vec<FieldError>, field: &str, message: impl Into<String>) {
    errors.push(FieldError {
        field: field.into(),
        message: message.into(),
    });
}

fn validate_agents_json(errors: &mut Vec<FieldError>, raw: &str) {
    let parsed: Result<Value, _> = serde_json::from_str(raw);
    let Ok(Value::Object(agents)) = parsed else {
        err(errors, "agents_json", "must be a JSON object of agent definitions");
        return;
    };
    for (name, agent) in agents {
        let has = |key: &str| {
            agent
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty())
        };
        if !has("description") || !has("prompt") {
            err(
                errors,
                "agents_json",
                format!("agent {name:?} needs non-empty description and prompt"),
            );
        }
    }
}

/// One row from the hook builder. Validate-only: commands are never executed
/// by OpsDeck, only compiled into the temp settings file.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "snake_case")]
pub struct HookRow {
    pub event: String,
    pub matcher: Option<String>,
    pub command: String,
    pub timeout: f64,
    pub enabled: bool,
}

impl Default for HookRow {
    fn default() -> Self {
        Self {
            event: String::new(),
            matcher: None,
            command: String::new(),
            timeout: 0.0,
            enabled: true,
        }
    }
}

pub fn parse_hook_rows(raw: &str) -> Result<Vec<HookRow>, String> {
    serde_json::from_str::<Vec<HookRow>>(raw)
        .map_err(|e| format!("must be a JSON array of hook rows: {e}"))
}

fn validate_hooks_json(errors: &mut Vec<FieldError>, raw: &str) {
    let rows = match parse_hook_rows(raw) {
        Ok(rows) => rows,
        Err(message) => {
            err(errors, "hooks_json", message);
            return;
        }
    };
    for (i, row) in rows.iter().enumerate() {
        if !HOOK_EVENTS.contains(&row.event.as_str()) {
            err(errors, "hooks_json", format!("row {i}: unknown event {:?}", row.event));
        }
        if row.command.trim().is_empty() {
            err(errors, "hooks_json", format!("row {i}: command is required"));
        }
        if row.timeout <= 0.0 {
            err(errors, "hooks_json", format!("row {i}: timeout must be > 0"));
        }
    }
}

pub fn validate_options(options: &LaunchOptions) -> Vec<FieldError> {
    let mut errors = Vec::new();

    if options.prompt.trim().is_empty() {
        err(&mut errors, "prompt", "prompt is required");
    }
    if options.cwd.is_empty() {
        err(&mut errors, "cwd", "working directory is required");
    } else if !expand_path(&options.cwd).is_dir() {
        err(&mut errors, "cwd", "directory does not exist");
    }
    if let Some(effort) = &options.effort {
        if !EFFORTS.contains(&effort.as_str()) {
            err(&mut errors, "effort", format!("must be one of {EFFORTS:?}"));
        }
    }
    if let Some(mode) = &options.permission_mode {
        if !PERMISSION_MODES.contains(&mode.as_str()) {
            err(
                &mut errors,
                "permission_mode",
                format!("must be one of {PERMISSION_MODES:?}"),
            );
        }
    }
    if let Some(budget) = options.max_budget_usd {
        if !(0.0..=MAX_BUDGET_USD).contains(&budget) {
            err(&mut errors, "max_budget_usd", "must be between 0 and 100000");
        }
    }
    if let Some(session_id) = &options.resume_session_id {
        if !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            err(&mut errors, "resume_session_id", "invalid session id");
        }
    }
    for path in &options.mcp_configs {
        if !expand_path(path).is_file() {
            err(&mut errors, "mcp_configs", format!("not a file: {path}"));
        }
    }
    for dir in &options.plugin_dirs {
        if !expand_path(dir).is_dir() {
            err(&mut errors, "plugin_dirs", format!("not a directory: {dir}"));
        }
    }
    for source in &options.setting_sources {
        if !SETTING_SOURCES.contains(&source.as_str()) {
            err(
                &mut errors,
                "setting_sources",
                format!("unknown source: {source}"),
            );
        }
    }
    if let Some(raw) = &options.agents_json {
        if !raw.trim().is_empty() {
            validate_agents_json(&mut errors, raw);
        }
    }
    if let Some(raw) = &options.hooks_json {
        if !raw.trim().is_empty() {
            validate_hooks_json(&mut errors, raw);
        }
    }
    if let Some(raw) = &options.settings_json {
        if !raw.trim().is_empty() {
            match serde_json::from_str::<Value>(raw) {
                Ok(Value::Object(_)) => {}
                _ => err(&mut errors, "settings_json", "must be a JSON object"),
            }
        }
    }
    errors
}

/// Pure options -> argv mapping. Never touches a shell; every value is its
/// own vector element. The initial prompt goes via stdin, not argv.
pub fn build_args(options: &LaunchOptions, settings_path: Option<&Path>) -> Vec<String> {
    let mut args: Vec<String> = [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--include-partial-messages",
        "--include-hook-events",
    ]
    .map(str::to_string)
    .to_vec();

    if let Some(model) = &options.model {
        args.extend(["--model".into(), model.clone()]);
    }
    if let Some(effort) = &options.effort {
        args.extend(["--effort".into(), effort.clone()]);
    }
    if let Some(mode) = &options.permission_mode {
        // UI's "manual" is the CLI's default prompt-everything mode.
        let cli_mode = if mode == "manual" { "default" } else { mode };
        args.extend(["--permission-mode".into(), cli_mode.into()]);
    }
    if let Some(budget) = options.max_budget_usd {
        args.extend(["--max-budget-usd".into(), budget.to_string()]);
    }
    if let Some(name) = &options.worktree_name {
        args.extend(["--worktree".into(), name.clone()]);
    } else if options.worktree {
        args.push("--worktree".into());
    }
    if let Some(session_id) = &options.resume_session_id {
        args.extend(["--resume".into(), session_id.clone()]);
        if options.fork_session {
            args.push("--fork-session".into());
        }
    }
    if !options.allowed_tools.is_empty() {
        args.extend(["--allowed-tools".into(), options.allowed_tools.join(",")]);
    }
    if !options.disallowed_tools.is_empty() {
        args.extend([
            "--disallowed-tools".into(),
            options.disallowed_tools.join(","),
        ]);
    }
    for config in &options.mcp_configs {
        args.extend(["--mcp-config".into(), config.clone()]);
    }
    if options.strict_mcp_config {
        args.push("--strict-mcp-config".into());
    }
    for dir in &options.plugin_dirs {
        args.extend(["--plugin-dir".into(), dir.clone()]);
    }
    if let Some(agents) = &options.agents_json {
        if !agents.trim().is_empty() {
            args.extend(["--agents".into(), agents.clone()]);
        }
    }
    if !options.setting_sources.is_empty() {
        args.extend([
            "--setting-sources".into(),
            options.setting_sources.join(","),
        ]);
    }
    if let Some(prompt) = &options.append_system_prompt {
        if !prompt.trim().is_empty() {
            args.extend(["--append-system-prompt".into(), prompt.clone()]);
        }
    }
    if let Some(path) = settings_path {
        args.extend(["--settings".into(), path.to_string_lossy().into_owned()]);
    }
    args.extend([
        "--add-dir".into(),
        expand_path(&options.cwd).to_string_lossy().into_owned(),
    ]);
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_options() -> LaunchOptions {
        LaunchOptions {
            cwd: "/tmp".into(),
            prompt: "hello".into(),
            ..Default::default()
        }
    }

    #[test]
    fn minimal_valid_options_pass() {
        assert!(validate_options(&valid_options()).is_empty());
    }

    #[test]
    fn missing_prompt_and_bad_cwd_fail() {
        let options = LaunchOptions {
            cwd: "/definitely/not/a/dir".into(),
            prompt: "  ".into(),
            ..Default::default()
        };
        let fields: Vec<String> = validate_options(&options)
            .into_iter()
            .map(|e| e.field)
            .collect();
        assert!(fields.contains(&"prompt".to_string()));
        assert!(fields.contains(&"cwd".to_string()));
    }

    #[test]
    fn enum_guards_reject_unknown_values() {
        let mut options = valid_options();
        options.effort = Some("ultra".into());
        options.permission_mode = Some("yolo".into());
        options.setting_sources = vec!["cloud".into()];
        let fields: Vec<String> = validate_options(&options)
            .into_iter()
            .map(|e| e.field)
            .collect();
        assert_eq!(fields, vec!["effort", "permission_mode", "setting_sources"]);
    }

    #[test]
    fn budget_bounds_enforced() {
        let mut options = valid_options();
        options.max_budget_usd = Some(-1.0);
        assert_eq!(validate_options(&options).len(), 1);
        options.max_budget_usd = Some(100_001.0);
        assert_eq!(validate_options(&options).len(), 1);
        options.max_budget_usd = Some(25.0);
        assert!(validate_options(&options).is_empty());
    }

    #[test]
    fn agents_json_requires_description_and_prompt() {
        let mut options = valid_options();
        options.agents_json = Some(r#"{"helper":{"description":"x","prompt":"y"}}"#.into());
        assert!(validate_options(&options).is_empty());
        options.agents_json = Some(r#"{"helper":{"description":"x"}}"#.into());
        assert_eq!(validate_options(&options).len(), 1);
        options.agents_json = Some("[]".into());
        assert_eq!(validate_options(&options).len(), 1);
    }

    #[test]
    fn hook_rows_validated() {
        let mut options = valid_options();
        options.hooks_json = Some(
            r#"[{"event":"PreToolUse","matcher":"Bash","command":"echo hi","timeout":30,"enabled":true}]"#
                .into(),
        );
        assert!(validate_options(&options).is_empty());
        options.hooks_json =
            Some(r#"[{"event":"NotAnEvent","command":"","timeout":0,"enabled":true}]"#.into());
        assert_eq!(validate_options(&options).len(), 3);
    }

    #[test]
    fn normalize_coerces_lists_and_clamps() {
        let mut options = valid_options();
        options.allowed_tools = vec!["Bash, Read\nEdit".into(), " ".into()];
        options.name = Some(format!("  {}  ", "n".repeat(300)));
        normalize_options(&mut options);
        assert_eq!(options.allowed_tools, vec!["Bash", "Read", "Edit"]);
        assert_eq!(options.name.as_ref().unwrap().chars().count(), 120);
    }

    #[test]
    fn expand_tilde() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_path("~"), home);
        assert_eq!(expand_path("~/x"), home.join("x"));
        assert_eq!(expand_path("/abs"), PathBuf::from("/abs"));
    }

    #[test]
    fn build_args_minimal_golden() {
        let args = build_args(&valid_options(), None);
        assert_eq!(
            args,
            vec![
                "--print",
                "--verbose",
                "--output-format",
                "stream-json",
                "--input-format",
                "stream-json",
                "--include-partial-messages",
                "--include-hook-events",
                "--add-dir",
                "/tmp",
            ]
        );
        // The prompt must never appear in argv (stdin-only).
        assert!(!args.iter().any(|a| a.contains("hello")));
    }

    #[test]
    fn build_args_full_golden() {
        let mut options = valid_options();
        options.model = Some("opus".into());
        options.effort = Some("high".into());
        options.permission_mode = Some("manual".into());
        options.max_budget_usd = Some(10.0);
        options.resume_session_id = Some("ses-1".into());
        options.fork_session = true;
        options.allowed_tools = vec!["Bash".into(), "Read".into()];
        options.disallowed_tools = vec!["Bash(rm *)".into()];
        options.mcp_configs = vec!["/tmp/mcp.json".into()];
        options.strict_mcp_config = true;
        options.plugin_dirs = vec!["/tmp/plugins".into()];
        options.agents_json = Some(r#"{"a":{"description":"d","prompt":"p"}}"#.into());
        options.setting_sources = vec!["user".into(), "project".into()];
        options.append_system_prompt = Some("be brief".into());
        let args = build_args(&options, Some(Path::new("/tmp/settings.json")));
        let joined = args.join("\u{1}");
        // manual -> default mapping
        assert!(joined.contains("--permission-mode\u{1}default"));
        assert!(joined.contains("--model\u{1}opus"));
        assert!(joined.contains("--effort\u{1}high"));
        assert!(joined.contains("--max-budget-usd\u{1}10"));
        assert!(joined.contains("--resume\u{1}ses-1"));
        assert!(args.contains(&"--fork-session".to_string()));
        assert!(joined.contains("--allowed-tools\u{1}Bash,Read"));
        assert!(joined.contains("--disallowed-tools\u{1}Bash(rm *)"));
        assert!(joined.contains("--mcp-config\u{1}/tmp/mcp.json"));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert!(joined.contains("--plugin-dir\u{1}/tmp/plugins"));
        assert!(joined.contains("--setting-sources\u{1}user,project"));
        assert!(joined.contains("--append-system-prompt\u{1}be brief"));
        assert!(joined.contains("--settings\u{1}/tmp/settings.json"));
        assert_eq!(&args[args.len() - 2..], ["--add-dir", "/tmp"]);
    }

    #[test]
    fn build_args_worktree_bare_vs_named() {
        let mut options = valid_options();
        options.worktree = true;
        let args = build_args(&options, None);
        let idx = args.iter().position(|a| a == "--worktree").unwrap();
        assert!(args[idx + 1].starts_with("--")); // bare flag

        options.worktree_name = Some("feature-x".into());
        let args = build_args(&options, None);
        let idx = args.iter().position(|a| a == "--worktree").unwrap();
        assert_eq!(args[idx + 1], "feature-x");
    }
}
