use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::options::LaunchOptions;

fn settings_dir() -> PathBuf {
    dirs::cache_dir()
        .map(|cache| cache.join("opsdeck"))
        .unwrap_or_else(std::env::temp_dir)
}

/// Write the per-job temp settings file when the options carry raw settings
/// JSON (the power-user escape hatch). Returns None when absent so the spawn
/// path skips the `--settings` flag entirely.
pub fn write_if_needed(job_id: &str, options: &LaunchOptions) -> Result<Option<PathBuf>, String> {
    let Some(raw) = options
        .settings_json
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    else {
        return Ok(None);
    };
    let settings = serde_json::from_str::<Value>(raw)
        .map_err(|e| format!("settings_json is not valid JSON: {e}"))?;
    let Value::Object(map) = settings else {
        return Err("settings_json must be a JSON object".into());
    };
    if map.is_empty() {
        return Ok(None);
    }

    let dir = settings_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create settings dir: {e}"))?;
    let path = dir.join(format!("settings-{job_id}.json"));
    fs::write(
        &path,
        serde_json::to_string_pretty(&Value::Object(map)).unwrap(),
    )
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
        let options = LaunchOptions {
            settings_json: Some("{}".into()),
            ..Default::default()
        };
        assert_eq!(write_if_needed("t-empty", &options).unwrap(), None);
    }

    #[test]
    fn raw_settings_written_then_cleanup() {
        let options = LaunchOptions {
            settings_json: Some(r#"{"env":{"FOO":"1"}}"#.into()),
            ..Default::default()
        };
        let path = write_if_needed("t-raw", &options).unwrap().unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["env"]["FOO"], "1");

        cleanup(&path);
        assert!(!path.exists());
    }

    #[test]
    fn non_object_settings_rejected() {
        let options = LaunchOptions {
            settings_json: Some("[1,2]".into()),
            ..Default::default()
        };
        assert!(write_if_needed("t-bad", &options).is_err());
    }
}
