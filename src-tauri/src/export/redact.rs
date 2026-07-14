//! Best-effort masking of common secret shapes before a transcript leaves
//! the app. Regexes catch the usual patterns only — the UI must present this
//! as "redact common secrets", never as a guarantee.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::commands::SessionDetail;
use crate::parser::normalize::Block;

const MASK: &str = "[REDACTED]";

fn sk_token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\bsk-[A-Za-z0-9_-]{8,}").expect("sk regex"))
}

/// `key = value`, `token: value`, `"api_key": "value"` … The value class
/// deliberately admits `[` and `]` so a second pass matches `[REDACTED]`
/// whole and rewrites it to itself (idempotency).
fn pair_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(api[_-]?key|access[_-]?key|secret[_-]?key|key|token|secret|password|passwd|pwd)\b("?\s*[:=]\s*"?)([^\s"',;]+)"#,
        )
        .expect("pair regex")
    })
}

fn bearer_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]+").expect("bearer regex")
    })
}

/// JSON object keys whose string values are masked outright, catching
/// secrets the free-text patterns cannot see (the value alone carries no
/// recognizable shape once split from its key).
fn sensitive_key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(api[_-]?key|token|secret|password|passwd|pwd|credential|authorization)")
            .expect("key regex")
    })
}

pub struct Redactor {
    home: Option<String>,
}

impl Redactor {
    pub fn new() -> Self {
        Self {
            home: dirs::home_dir().map(|p| p.to_string_lossy().into_owned()),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_home(home: &str) -> Self {
        Self {
            home: Some(home.to_string()),
        }
    }

    pub fn redact_str(&self, text: &str) -> String {
        let text = pair_re().replace_all(text, format!("${{1}}${{2}}{MASK}").as_str());
        let text = sk_token_re().replace_all(&text, format!("sk-{MASK}").as_str());
        let text = bearer_re().replace_all(&text, format!("Bearer {MASK}").as_str());
        match &self.home {
            Some(home) if !home.is_empty() => text.replace(home.as_str(), "~"),
            _ => text.into_owned(),
        }
    }

    /// Project ids are the dash-encoded session cwd (`/Users/alice/proj` →
    /// `-Users-alice-proj`), so the plain-path home replacement never
    /// matches them and the username would leak. Strip the dash-encoded
    /// home prefix the same way paths get their `~`.
    pub fn redact_project_id(&self, id: &str) -> String {
        match &self.home {
            Some(home) if !home.is_empty() => {
                let dashed = home.replace(['/', '.'], "-");
                match id.strip_prefix(dashed.as_str()) {
                    Some(rest) => format!("~{rest}"),
                    None => id.to_string(),
                }
            }
            _ => id.to_string(),
        }
    }

    /// Recursive walk: string leaves get the pattern pass; string values
    /// under sensitive keys are masked outright. Non-string leaves are
    /// untouched.
    pub fn redact_value(&self, value: &mut Value) {
        match value {
            Value::String(s) => *s = self.redact_str(s),
            Value::Array(items) => {
                for item in items {
                    self.redact_value(item);
                }
            }
            Value::Object(map) => {
                for (key, item) in map.iter_mut() {
                    if sensitive_key_re().is_match(key) && item.is_string() {
                        *item = Value::String(MASK.to_string());
                    } else {
                        self.redact_value(item);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Redact every transcript-derived string in a session detail, in place.
pub fn redact_detail(detail: &mut SessionDetail) {
    redact_detail_with(&Redactor::new(), detail);
}

pub(crate) fn redact_detail_with(redactor: &Redactor, detail: &mut SessionDetail) {
    detail.meta.project_id = redactor.redact_project_id(&detail.meta.project_id);
    detail.meta.preview = redactor.redact_str(&detail.meta.preview);
    if let Some(cwd) = &detail.meta.cwd {
        detail.meta.cwd = Some(redactor.redact_str(cwd));
    }
    if let Some(branch) = &detail.meta.git_branch {
        detail.meta.git_branch = Some(redactor.redact_str(branch));
    }
    for message in &mut detail.messages {
        for block in &mut message.blocks {
            match block {
                Block::Text { text } => *text = redactor.redact_str(text),
                Block::Thinking { thinking } => *thinking = redactor.redact_str(thinking),
                Block::ToolUse { input, result, .. } => {
                    redactor.redact_value(input);
                    if let Some(info) = result {
                        info.content = redactor.redact_str(&info.content);
                    }
                }
                Block::ToolResult { content, .. } => *content = redactor.redact_str(content),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn redactor() -> Redactor {
        Redactor::with_home("/Users/testuser")
    }

    #[test]
    fn masks_sk_style_tokens() {
        let out = redactor().redact_str("used sk-ant-api03-abc123XYZ for the call");
        assert_eq!(out, "used sk-[REDACTED] for the call");
    }

    #[test]
    fn masks_key_value_pairs_in_all_spellings() {
        let cases = [
            ("api_key=abc123def", "api_key=[REDACTED]"),
            ("TOKEN: hunter2secret", "TOKEN: [REDACTED]"),
            ("password = s3cr3t!pass", "password = [REDACTED]"),
            (r#""secret": "abc123""#, r#""secret": "[REDACTED]""#),
        ];
        for (input, expected) in cases {
            assert_eq!(redactor().redact_str(input), expected, "input: {input}");
        }
    }

    #[test]
    fn masks_bearer_values() {
        let out = redactor().redact_str("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload");
        assert_eq!(out, "Authorization: Bearer [REDACTED]");
    }

    #[test]
    fn replaces_home_directory_with_tilde() {
        let out = redactor().redact_str("wrote /Users/testuser/Documents/notes.txt");
        assert_eq!(out, "wrote ~/Documents/notes.txt");
    }

    #[test]
    fn project_id_loses_the_dash_encoded_home_prefix() {
        let out = redactor().redact_project_id("-Users-testuser-Documents-proj");
        assert_eq!(out, "~-Documents-proj");
        // A second pass finds no prefix to strip and changes nothing.
        assert_eq!(redactor().redact_project_id(&out), out);
    }

    #[test]
    fn project_id_outside_home_is_unchanged() {
        let id = "-opt-shared-workspace";
        assert_eq!(redactor().redact_project_id(id), id);
    }

    #[test]
    fn plain_prose_passes_through_unchanged() {
        let text = "The keyboard token count is fine; no secrets here.";
        assert_eq!(redactor().redact_str(text), text);
    }

    #[test]
    fn redaction_is_idempotent() {
        let corpus = [
            "api_key=abc123def and sk-ant-api03-abc123XYZ",
            "Bearer eyJhbGciOiJIUzI1NiJ9",
            "password: hunter2 at /Users/testuser/project",
            r#"{"token": "abc"} key = value"#,
        ];
        for input in corpus {
            let once = redactor().redact_str(input);
            let twice = redactor().redact_str(&once);
            assert_eq!(once, twice, "not idempotent for: {input}");
        }
    }

    #[test]
    fn json_walker_masks_sensitive_keys_and_leaves_other_types_alone() {
        let mut value = json!({
            "api_key": "abc123",
            "nested": {
                "session_token": "xyz789",
                "count": 42,
                "flag": true,
                "items": ["sk-ant-api03-abc123XYZ", 7]
            },
            "note": "plain text"
        });
        redactor().redact_value(&mut value);
        assert_eq!(value["api_key"], "[REDACTED]");
        assert_eq!(value["nested"]["session_token"], "[REDACTED]");
        assert_eq!(value["nested"]["count"], 42);
        assert_eq!(value["nested"]["flag"], true);
        assert_eq!(value["nested"]["items"][0], "sk-[REDACTED]");
        assert_eq!(value["nested"]["items"][1], 7);
        assert_eq!(value["note"], "plain text");
    }

    #[test]
    fn json_walker_is_idempotent() {
        let mut once = json!({"password": "abc", "text": "token: xyz123abc"});
        redactor().redact_value(&mut once);
        let mut twice = once.clone();
        redactor().redact_value(&mut twice);
        assert_eq!(once, twice);
    }
}
