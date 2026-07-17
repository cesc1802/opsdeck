use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bound on stored tool-result/notice content so the 1000-event ring buffer
/// cannot hold unbounded output from a runaway job.
const CONTENT_CLAMP: usize = 8_000;

/// Normalized app-side event stream. The CLI's stream-json lines are bridged
/// into this enum; unknown CLI event types pass through as `Notice` so newer
/// CLI versions degrade gracefully instead of breaking the chat.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum JobEventPayload {
    SessionStarted {
        session_id: String,
        model: String,
        cwd: String,
        tools: Vec<String>,
        /// Session-authoritative slash-invocable names from the CLI's init
        /// payload (skills, custom/plugin commands, built-ins). Empty when an
        /// older CLI omits the key.
        slash_commands: Vec<String>,
        agents: Vec<String>,
    },
    /// A message the user sent to this job (initial prompt or follow-up).
    /// Pushed locally when writing to stdin — the CLI does not echo it — so
    /// buffer replay reconstructs both sides of the conversation.
    UserMessage {
        text: String,
    },
    TextDelta {
        text: String,
    },
    ThinkingDelta {
        text: String,
    },
    ToolUseStart {
        tool_id: String,
        name: String,
    },
    ToolUse {
        tool_id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_id: String,
        is_error: bool,
        content: String,
    },
    HookEvent {
        raw: Value,
    },
    Notice {
        message: String,
    },
    Stderr {
        line: String,
    },
    TurnResult {
        subtype: String,
        is_error: bool,
        cost_usd: Option<f64>,
        usage: Option<Value>,
        duration_ms: Option<f64>,
        num_turns: Option<u32>,
    },
    ProcessExit {
        code: Option<i32>,
    },
}

fn clamp(text: &str) -> String {
    if text.chars().count() <= CONTENT_CLAMP {
        return text.to_string();
    }
    let truncated: String = text.chars().take(CONTENT_CLAMP).collect();
    format!("{truncated}… [truncated]")
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// String array field, empty when absent or wrongly typed (older CLIs may
/// omit init keys; degrade instead of failing the bridge).
fn str_array(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Flatten a tool_result `content` (string or block array) into plain text.
fn result_content(content: &Value) -> String {
    match content {
        Value::String(s) => clamp(s),
        Value::Array(blocks) => {
            let joined = blocks
                .iter()
                .map(|b| match b.get("type").and_then(Value::as_str) {
                    Some("text") => str_field(b, "text"),
                    _ => b.to_string(),
                })
                .collect::<Vec<_>>()
                .join("\n");
            clamp(&joined)
        }
        Value::Null => String::new(),
        other => clamp(&other.to_string()),
    }
}

fn bridge_stream_event(event: &Value) -> Vec<JobEventPayload> {
    match event.get("type").and_then(Value::as_str) {
        Some("content_block_delta") => {
            let delta = event.get("delta").unwrap_or(&Value::Null);
            match delta.get("type").and_then(Value::as_str) {
                Some("text_delta") => vec![JobEventPayload::TextDelta {
                    text: str_field(delta, "text"),
                }],
                Some("thinking_delta") => vec![JobEventPayload::ThinkingDelta {
                    text: str_field(delta, "thinking"),
                }],
                _ => vec![],
            }
        }
        Some("content_block_start") => {
            let block = event.get("content_block").unwrap_or(&Value::Null);
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                vec![JobEventPayload::ToolUseStart {
                    tool_id: str_field(block, "id"),
                    name: str_field(block, "name"),
                }]
            } else {
                vec![]
            }
        }
        // message_start/message_delta/message_stop/content_block_stop are
        // framing noise for our purposes.
        _ => vec![],
    }
}

/// Extract tool_use blocks from a complete assistant message (full inputs —
/// deltas only carry partial JSON) and tool_result blocks from user messages.
fn bridge_message_content(v: &Value, block_type: &str) -> Vec<JobEventPayload> {
    let Some(blocks) = v
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return vec![];
    };
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some(block_type))
        .map(|b| match block_type {
            "tool_use" => JobEventPayload::ToolUse {
                tool_id: str_field(b, "id"),
                name: str_field(b, "name"),
                input: b.get("input").cloned().unwrap_or(Value::Null),
            },
            _ => JobEventPayload::ToolResult {
                tool_id: str_field(b, "tool_use_id"),
                is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                content: result_content(b.get("content").unwrap_or(&Value::Null)),
            },
        })
        .collect()
}

/// One CLI stream-json line → zero or more app events. Malformed lines become
/// a `Notice` (never dropped silently, never fatal).
pub fn bridge_line(line: &str) -> Vec<JobEventPayload> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let Ok(v) = serde_json::from_str::<Value>(trimmed) else {
        return vec![JobEventPayload::Notice {
            message: clamp(&format!("unparseable CLI output: {trimmed}")),
        }];
    };

    let event_type = v.get("type").and_then(Value::as_str).unwrap_or("");
    match event_type {
        "system" => match v.get("subtype").and_then(Value::as_str) {
            Some("init") => vec![JobEventPayload::SessionStarted {
                session_id: str_field(&v, "session_id"),
                model: str_field(&v, "model"),
                cwd: str_field(&v, "cwd"),
                tools: str_array(&v, "tools"),
                slash_commands: str_array(&v, "slash_commands"),
                agents: str_array(&v, "agents"),
            }],
            _ => vec![JobEventPayload::Notice {
                message: clamp(&v.to_string()),
            }],
        },
        "stream_event" => bridge_stream_event(v.get("event").unwrap_or(&Value::Null)),
        "assistant" => bridge_message_content(&v, "tool_use"),
        "user" => bridge_message_content(&v, "tool_result"),
        "result" => vec![JobEventPayload::TurnResult {
            subtype: str_field(&v, "subtype"),
            is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
            cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
            usage: v.get("usage").cloned().filter(|u| !u.is_null()),
            duration_ms: v.get("duration_ms").and_then(Value::as_f64),
            num_turns: v.get("num_turns").and_then(Value::as_u64).map(|n| n as u32),
        }],
        t if t.starts_with("hook") => vec![JobEventPayload::HookEvent { raw: v }],
        _ => vec![JobEventPayload::Notice {
            message: clamp(&v.to_string()),
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/stream_json_sample.jsonl");

    fn bridge_all(input: &str) -> Vec<JobEventPayload> {
        input.lines().flat_map(bridge_line).collect()
    }

    #[test]
    fn fixture_stream_bridges_to_expected_sequence() {
        let events = bridge_all(FIXTURE);
        let kinds: Vec<&str> = events
            .iter()
            .map(|e| match e {
                JobEventPayload::SessionStarted { .. } => "session_started",
                JobEventPayload::UserMessage { .. } => "user_message",
                JobEventPayload::TextDelta { .. } => "text_delta",
                JobEventPayload::ThinkingDelta { .. } => "thinking_delta",
                JobEventPayload::ToolUseStart { .. } => "tool_use_start",
                JobEventPayload::ToolUse { .. } => "tool_use",
                JobEventPayload::ToolResult { .. } => "tool_result",
                JobEventPayload::HookEvent { .. } => "hook_event",
                JobEventPayload::Notice { .. } => "notice",
                JobEventPayload::Stderr { .. } => "stderr",
                JobEventPayload::TurnResult { .. } => "turn_result",
                JobEventPayload::ProcessExit { .. } => "process_exit",
            })
            .collect();
        assert_eq!(
            kinds,
            vec![
                "session_started",
                "thinking_delta",
                "text_delta",
                "text_delta",
                "tool_use_start",
                "tool_use",
                "tool_result",
                "hook_event",
                "turn_result",
                "notice", // unknown event type passes through
            ]
        );
    }

    #[test]
    fn session_started_carries_identity() {
        let events = bridge_all(FIXTURE);
        let JobEventPayload::SessionStarted {
            session_id,
            model,
            cwd,
            tools,
            slash_commands,
            agents,
        } = &events[0]
        else {
            panic!("first event should be session_started");
        };
        assert_eq!(session_id, "ses_123");
        assert_eq!(model, "claude-sonnet-5");
        assert_eq!(cwd, "/tmp/demo");
        assert_eq!(tools, &["Bash".to_string(), "Read".to_string()]);
        assert_eq!(slash_commands, &["compact".to_string(), "cook".to_string()]);
        assert_eq!(agents, &["code-reviewer".to_string()]);
    }

    #[test]
    fn turn_result_carries_cost_and_usage() {
        let events = bridge_all(FIXTURE);
        let Some(JobEventPayload::TurnResult {
            subtype,
            is_error,
            cost_usd,
            usage,
            num_turns,
            ..
        }) = events
            .iter()
            .find(|e| matches!(e, JobEventPayload::TurnResult { .. }))
        else {
            panic!("expected turn_result");
        };
        assert_eq!(subtype, "success");
        assert!(!is_error);
        assert_eq!(*cost_usd, Some(0.0421));
        assert_eq!(*num_turns, Some(2));
        assert!(usage.as_ref().unwrap().get("output_tokens").is_some());
    }

    #[test]
    fn tool_use_has_full_input_and_result_flattens_blocks() {
        let events = bridge_all(FIXTURE);
        let tool_use = events
            .iter()
            .find(|e| matches!(e, JobEventPayload::ToolUse { .. }))
            .unwrap();
        if let JobEventPayload::ToolUse { name, input, .. } = tool_use {
            assert_eq!(name, "Bash");
            assert_eq!(input["command"], "ls");
        }
        let tool_result = events
            .iter()
            .find(|e| matches!(e, JobEventPayload::ToolResult { .. }))
            .unwrap();
        if let JobEventPayload::ToolResult {
            content, is_error, ..
        } = tool_result
        {
            assert!(!is_error);
            assert_eq!(content, "file-a\nfile-b");
        }
    }

    #[test]
    fn malformed_and_unknown_lines_become_notices() {
        let events = bridge_all("this is not json\n{\"type\":\"mystery_event\",\"x\":1}");
        assert_eq!(events.len(), 2);
        assert!(
            matches!(&events[0], JobEventPayload::Notice { message } if message.contains("unparseable"))
        );
        assert!(
            matches!(&events[1], JobEventPayload::Notice { message } if message.contains("mystery_event"))
        );
    }

    #[test]
    fn oversized_content_is_clamped() {
        let big = "x".repeat(20_000);
        let line = serde_json::json!({
            "type": "user",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": big}]}
        })
        .to_string();
        let events = bridge_line(&line);
        let JobEventPayload::ToolResult { content, .. } = &events[0] else {
            panic!("expected tool_result");
        };
        assert!(content.len() < 9_000);
        assert!(content.ends_with("[truncated]"));
    }

    #[test]
    fn empty_lines_produce_nothing() {
        assert!(bridge_line("").is_empty());
        assert!(bridge_line("   ").is_empty());
    }
}
