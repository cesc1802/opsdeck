use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::options::{parse_hook_rows, LaunchOptions};

/// Compile enabled hook-builder rows into the settings `hooks` shape:
/// `{ "PreToolUse": [{ "matcher": ..., "hooks": [{type,command,timeout}] }] }`.
fn compile_hooks(raw: &str) -> Option<Value> {
    let rows = parse_hook_rows(raw).ok()?;
    let mut by_event: Map<String, Value> = Map::new();
    for row in rows.into_iter().filter(|r| r.enabled) {
        let mut entry = Map::new();
        if let Some(matcher) = row.matcher.as_deref().filter(|m| !m.trim().is_empty()) {
            entry.insert("matcher".into(), json!(matcher));
        }
        entry.insert(
            "hooks".into(),
            json!([{ "type": "command", "command": row.command, "timeout": row.timeout }]),
        );
        by_event
            .entry(row.event)
            .or_insert_with(|| Value::Array(vec![]))
            .as_array_mut()
            .expect("hook event entries are arrays")
            .push(Value::Object(entry));
    }
    if by_event.is_empty() {
        None
    } else {
        Some(Value::Object(by_event))
    }
}

fn settings_dir() -> PathBuf {
    dirs::cache_dir()
        .map(|cache| cache.join("opsdeck"))
        .unwrap_or_else(std::env::temp_dir)
}

/// Write the per-job temp settings file when the options carry hooks or raw
/// settings. Merge is shallow: raw settings object first, hooks override the
/// `hooks` key (matches the reference app's behavior). Returns None when
/// neither is present.
pub fn write_if_needed(job_id: &str, options: &LaunchOptions) -> Result<Option<PathBuf>, String> {
    let raw_settings = options
        .settings_json
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            serde_json::from_str::<Value>(s)
                .map_err(|e| format!("settings_json is not valid JSON: {e}"))
        })
        .transpose()?;
    let hooks = options
        .hooks_json
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(compile_hooks);

    let mut merged = match raw_settings {
        Some(Value::Object(map)) => map,
        Some(_) => return Err("settings_json must be a JSON object".into()),
        None => Map::new(),
    };
    if let Some(hooks) = hooks {
        merged.insert("hooks".into(), hooks);
    }
    if merged.is_empty() {
        return Ok(None);
    }

    let dir = settings_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create settings dir: {e}"))?;
    let path = dir.join(format!("settings-{job_id}.json"));
    fs::write(&path, serde_json::to_string_pretty(&Value::Object(merged)).unwrap())
        .map_err(|e| format!("cannot write settings file: {e}"))?;
    Ok(Some(path))
}

pub fn cleanup(path: &Path) {
    let _ = fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_settings_no_file() {
        let options = LaunchOptions::default();
        assert_eq!(write_if_needed("t-none", &options).unwrap(), None);
    }

    #[test]
    fn hooks_and_raw_settings_merge_then_cleanup() {
        let options = LaunchOptions {
            settings_json: Some(r#"{"env":{"FOO":"1"},"hooks":{"stale":true}}"#.into()),
            hooks_json: Some(
                r#"[
                    {"event":"PreToolUse","matcher":"Bash","command":"echo pre","timeout":10,"enabled":true},
                    {"event":"PreToolUse","command":"echo all","timeout":5,"enabled":true},
                    {"event":"Stop","command":"echo off","timeout":5,"enabled":false}
                ]"#
                .into(),
            ),
            ..Default::default()
        };
        let path = write_if_needed("t-merge", &options).unwrap().unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        // Raw settings preserved; compiled hooks override the raw hooks key.
        assert_eq!(value["env"]["FOO"], "1");
        let pre = value["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 2);
        assert_eq!(pre[0]["matcher"], "Bash");
        assert_eq!(pre[0]["hooks"][0]["command"], "echo pre");
        assert!(pre[1].get("matcher").is_none());
        // Disabled rows are dropped entirely.
        assert!(value["hooks"].get("Stop").is_none());

        cleanup(&path);
        assert!(!path.exists());
    }

    #[test]
    fn hooks_only_produces_file() {
        let options = LaunchOptions {
            hooks_json: Some(
                r#"[{"event":"SessionStart","command":"echo hi","timeout":5,"enabled":true}]"#.into(),
            ),
            ..Default::default()
        };
        let path = write_if_needed("t-hooks", &options).unwrap().unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert!(value["hooks"]["SessionStart"].is_array());
        cleanup(&path);
    }
}
