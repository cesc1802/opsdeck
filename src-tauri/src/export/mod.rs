pub mod redact;
pub mod render_html;
pub mod render_markdown;

use serde::{Deserialize, Serialize};

use crate::commands::SessionDetail;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Md,
    Json,
    Html,
}

/// Render a (possibly already redacted) session into the chosen format.
/// JSON keeps full fidelity; md/html clamp long tool results for reading.
pub fn render(detail: &SessionDetail, format: ExportFormat) -> Result<String, String> {
    match format {
        ExportFormat::Md => Ok(render_markdown::render(detail)),
        ExportFormat::Json => serde_json::to_string_pretty(detail)
            .map_err(|e| format!("cannot serialize session: {e}")),
        ExportFormat::Html => Ok(render_html::render(detail)),
    }
}

#[cfg(test)]
pub(crate) mod test_fixtures {
    use serde_json::json;

    use crate::commands::SessionDetail;
    use crate::parser::meta::{ModelTokens, SessionMeta};
    use crate::parser::normalize::{Block, Message, TokenUsage, ToolResultInfo};

    pub fn sample_detail() -> SessionDetail {
        SessionDetail {
            meta: SessionMeta {
                session_id: "sess-1".into(),
                project_id: "proj-1".into(),
                started_at: Some("2026-07-14T09:00:00Z".into()),
                ended_at: Some("2026-07-14T09:05:00Z".into()),
                message_count: 2,
                tokens: TokenUsage {
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_creation_input_tokens: 10,
                    cache_read_input_tokens: 5,
                },
                estimated_cost_usd: 0.42,
                models: vec!["claude-sonnet-5".into()],
                model_tokens: vec![ModelTokens {
                    model: "claude-sonnet-5".into(),
                    total_tokens: 165,
                }],
                cli_version: Some("2.1.0".into()),
                git_branch: Some("main".into()),
                cwd: Some("/Users/testuser/project".into()),
                preview: "fix the login bug".into(),
                is_active: false,
            },
            messages: vec![
                Message {
                    uuid: Some("u1".into()),
                    message_id: None,
                    role: "user".into(),
                    timestamp: Some("2026-07-14T09:00:00Z".into()),
                    model: None,
                    usage: None,
                    blocks: vec![Block::Text {
                        text: "fix the login bug".into(),
                    }],
                },
                Message {
                    uuid: Some("a1".into()),
                    message_id: Some("msg_1".into()),
                    role: "assistant".into(),
                    timestamp: Some("2026-07-14T09:00:05Z".into()),
                    model: Some("claude-sonnet-5".into()),
                    usage: None,
                    blocks: vec![
                        Block::Thinking {
                            thinking: "weighing the options".into(),
                        },
                        Block::Text {
                            text: "Looking at the auth module.".into(),
                        },
                        Block::ToolUse {
                            id: "tool-1".into(),
                            name: "Bash".into(),
                            input: json!({"command": "grep -rn login src/"}),
                            result: Some(ToolResultInfo {
                                is_error: false,
                                content: "src/auth.ts:42: login()".into(),
                            }),
                        },
                    ],
                },
            ],
            malformed_lines: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_fixtures::sample_detail;

    #[test]
    fn json_export_round_trips_the_full_detail() {
        let detail = sample_detail();
        let text = render(&detail, ExportFormat::Json).unwrap();
        let parsed: SessionDetail = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed.meta.session_id, detail.meta.session_id);
        assert_eq!(parsed.messages.len(), detail.messages.len());
    }

    #[test]
    fn redaction_carries_through_every_format() {
        let mut detail = sample_detail();
        detail.meta.project_id = "-Users-testuser-Documents-proj".into();
        detail.messages[0].blocks = vec![crate::parser::normalize::Block::Text {
            text: "use api_key=abc123def and sk-ant-api03-abc123XYZ".into(),
        }];
        redact::redact_detail_with(&redact::Redactor::with_home("/Users/testuser"), &mut detail);
        for format in [ExportFormat::Md, ExportFormat::Json, ExportFormat::Html] {
            let text = render(&detail, format).unwrap();
            assert!(!text.contains("abc123def"), "secret leaked in {format:?}");
            assert!(
                !text.contains("sk-ant-api03"),
                "sk token leaked in {format:?}"
            );
            // The username must not survive anywhere — not in the cwd path
            // and not in the dash-encoded project id.
            assert!(!text.contains("testuser"), "username leaked in {format:?}");
        }
    }
}
