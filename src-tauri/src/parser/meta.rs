use std::collections::HashMap;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::normalize::{Message, TokenUsage};
use super::raw::RawLine;
use crate::pricing::{cost_usd, PricingTable};

/// A session file is "active" if it was modified within this window.
pub const ACTIVE_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Whether a file mtime falls inside the active window.
pub fn is_active_mtime(mtime: Option<SystemTime>) -> bool {
    mtime
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .map(|age| age < ACTIVE_WINDOW)
        .unwrap_or(false)
}

const PREVIEW_MAX_CHARS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionMeta {
    pub session_id: String,
    pub project_id: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub message_count: u32,
    pub tokens: TokenUsage,
    pub estimated_cost_usd: f64,
    pub models: Vec<String>,
    pub cli_version: Option<String>,
    pub git_branch: Option<String>,
    pub cwd: Option<String>,
    pub preview: String,
    pub is_active: bool,
}

/// Sum usage across raw lines (not normalized messages, so a turn whose last
/// streamed chunk normalizes away still counts), deduplicating chunks that
/// share one API message id (each chunk repeats the turn's cumulative usage —
/// last chunk wins). Cost is computed per entry with that entry's model.
fn total_usage_and_cost(lines: &[RawLine], table: &PricingTable) -> (TokenUsage, f64) {
    // message_id -> (model, usage); entries without an id are summed directly.
    let mut by_id: HashMap<&str, (Option<&str>, TokenUsage)> = HashMap::new();
    let mut anonymous: Vec<(Option<&str>, TokenUsage)> = Vec::new();

    for line in lines {
        let Some(message) = &line.message else { continue };
        let Some(usage) = message.usage.as_ref().map(super::normalize::usage_from_raw)
        else {
            continue;
        };
        let model = message.model.as_deref();
        match message.id.as_deref() {
            Some(id) => {
                by_id.insert(id, (model, usage));
            }
            None => anonymous.push((model, usage)),
        }
    }

    let mut totals = TokenUsage::default();
    let mut cost = 0.0;
    for (model, usage) in by_id.values().chain(anonymous.iter()) {
        totals.add(usage);
        cost += cost_usd(table, model.unwrap_or_default(), usage);
    }
    (totals, cost)
}

fn distinct_models(lines: &[RawLine]) -> Vec<String> {
    let mut models: Vec<String> = Vec::new();
    for line in lines {
        if let Some(model) = line.message.as_ref().and_then(|m| m.model.as_ref()) {
            if !models.iter().any(|m| m == model) {
                models.push(model.clone());
            }
        }
    }
    models
}

/// Remove every `<tag>...</tag>` span, including the content.
fn strip_span(text: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(&open) {
        out.push_str(&rest[..start]);
        match rest[start..].find(&close) {
            Some(end_rel) => rest = &rest[start + end_rel + close.len()..],
            None => return out, // unterminated span: drop the tail
        }
    }
    out.push_str(rest);
    out
}

/// Remove `<tag>` / `</tag>` markers but keep the content between them.
fn unwrap_tag(text: &str, tag: &str) -> String {
    text.replace(&format!("<{tag}>"), " ")
        .replace(&format!("</{tag}>"), " ")
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let cut: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

/// Clean one user-text candidate into a list-friendly preview line.
pub fn clean_preview(text: &str) -> String {
    let mut out = text.to_string();
    for tag in ["local-command-caveat", "local-command-stdout", "local-command-stderr"] {
        out = strip_span(&out, tag);
    }
    for tag in ["command-name", "command-message", "command-args"] {
        out = unwrap_tag(&out, tag);
    }
    truncate_chars(&collapse_whitespace(&out), PREVIEW_MAX_CHARS)
}

/// First user text in the raw content value (string, or first text block).
fn user_text(content: &Value) -> Option<String> {
    match content {
        Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        Value::Array(items) => items.iter().find_map(|item| {
            if item.get("type").and_then(Value::as_str) == Some("text") {
                let text = item.get("text").and_then(Value::as_str)?;
                if text.trim().is_empty() {
                    None
                } else {
                    Some(text.to_string())
                }
            } else {
                None
            }
        }),
        _ => None,
    }
}

fn preview_from_lines(lines: &[RawLine]) -> String {
    for line in lines {
        if line.is_meta.unwrap_or(false) {
            continue;
        }
        if line.line_type.as_deref() != Some("user") {
            continue;
        }
        let Some(message) = &line.message else { continue };
        let Some(content) = &message.content else { continue };
        let Some(text) = user_text(content) else { continue };
        let cleaned = clean_preview(&text);
        if !cleaned.is_empty() {
            return cleaned;
        }
    }
    String::new()
}

fn first_some<'a, F>(lines: &'a [RawLine], get: F) -> Option<String>
where
    F: Fn(&'a RawLine) -> Option<&'a String>,
{
    lines.iter().find_map(|l| get(l).cloned())
}

pub fn derive_meta(
    project_id: &str,
    session_id: &str,
    lines: &[RawLine],
    messages: &[Message],
    mtime: Option<SystemTime>,
    table: &PricingTable,
) -> SessionMeta {
    let (tokens, estimated_cost_usd) = total_usage_and_cost(lines, table);
    let is_active = is_active_mtime(mtime);

    SessionMeta {
        session_id: session_id.to_string(),
        project_id: project_id.to_string(),
        started_at: first_some(lines, |l| l.timestamp.as_ref()),
        ended_at: lines.iter().rev().find_map(|l| l.timestamp.clone()),
        message_count: messages.len() as u32,
        tokens,
        estimated_cost_usd,
        models: distinct_models(lines),
        cli_version: first_some(lines, |l| l.version.as_ref()),
        git_branch: first_some(lines, |l| l.git_branch.as_ref()),
        cwd: first_some(lines, |l| l.cwd.as_ref()),
        preview: preview_from_lines(lines),
        is_active,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_strips_command_wrappers() {
        let raw = "<command-name>/cook</command-name> <command-args>plan.md</command-args>\
                   <local-command-stdout>noise\nnoise</local-command-stdout>";
        assert_eq!(clean_preview(raw), "/cook plan.md");
    }

    #[test]
    fn preview_collapses_whitespace_and_truncates() {
        let long = format!("hello   world\n\n{}", "x".repeat(400));
        let preview = clean_preview(&long);
        assert!(preview.starts_with("hello world x"));
        assert!(preview.chars().count() <= 200);
        assert!(preview.ends_with('…'));
    }

    #[test]
    fn preview_survives_unterminated_span() {
        let raw = "before <local-command-stdout>never closed";
        assert_eq!(clean_preview(raw), "before");
    }
}
