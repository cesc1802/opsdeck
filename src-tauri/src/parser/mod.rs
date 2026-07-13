pub mod meta;
pub mod normalize;
pub mod raw;

use normalize::Message;
use raw::RawLine;

pub struct ParsedSession {
    pub raw_lines: Vec<RawLine>,
    pub messages: Vec<Message>,
    pub malformed_lines: u32,
}

/// Parse a whole session file: tolerant line parse, then normalization with
/// tool_use/tool_result pairing. Malformed lines are counted, never fatal.
pub fn parse_session(text: &str) -> ParsedSession {
    let (raw_lines, malformed_lines) = normalize::parse_raw_lines(text);
    let messages = normalize::normalize(&raw_lines);
    ParsedSession {
        raw_lines,
        messages,
        malformed_lines,
    }
}

#[cfg(test)]
mod tests {
    use super::normalize::Block;
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/sample_session.jsonl");

    #[test]
    fn fixture_parses_with_expected_shape() {
        let parsed = parse_session(FIXTURE);
        assert_eq!(parsed.malformed_lines, 1, "fixture embeds one garbage line");
        // 1 user + 2 assistant survive; the tool-result-only user line and the
        // meta/system/summary lines are dropped or skipped.
        assert_eq!(parsed.messages.len(), 3);
        assert_eq!(parsed.messages[0].role, "user");
        assert_eq!(parsed.messages[1].role, "assistant");
    }

    #[test]
    fn tool_result_pairs_onto_tool_use() {
        let parsed = parse_session(FIXTURE);
        let tool_use = parsed
            .messages
            .iter()
            .flat_map(|m| &m.blocks)
            .find_map(|b| match b {
                Block::ToolUse { name, result, .. } => Some((name.clone(), result.clone())),
                _ => None,
            })
            .expect("fixture has a tool_use block");
        assert_eq!(tool_use.0, "Bash");
        let result = tool_use.1.expect("tool_result paired onto tool_use");
        assert!(!result.is_error);
        assert!(result.content.contains("total 0"));
        // The standalone copy of the paired result must be gone.
        let stray_results = parsed
            .messages
            .iter()
            .flat_map(|m| &m.blocks)
            .filter(|b| matches!(b, Block::ToolResult { .. }))
            .count();
        assert_eq!(stray_results, 0);
    }

    #[test]
    fn garbage_lines_are_counted_not_fatal() {
        let mut text = String::from(FIXTURE);
        text.push_str("\n{broken json\nnot json at all\n");
        let parsed = parse_session(&text);
        assert_eq!(parsed.malformed_lines, 3);
        assert_eq!(parsed.messages.len(), 3);
    }

    #[test]
    fn meta_totals_dedupe_streamed_chunks() {
        let parsed = parse_session(FIXTURE);
        let table = crate::pricing::pricing_table();
        let meta = meta::derive_meta(
            "proj",
            "sess",
            &parsed.raw_lines,
            &parsed.messages,
            None,
            &table,
        );
        // Two assistant lines share message id msg_01 (streamed chunks, the
        // second repeats cumulative usage) -> counted once, last wins.
        assert_eq!(meta.tokens.input_tokens, 12);
        assert_eq!(meta.tokens.output_tokens, 60);
        assert_eq!(meta.tokens.cache_creation_input_tokens, 100);
        assert_eq!(meta.tokens.cache_read_input_tokens, 2000);
        assert_eq!(meta.message_count, 3);
        assert_eq!(meta.models, vec!["claude-sonnet-5".to_string()]);
        assert_eq!(meta.cli_version.as_deref(), Some("2.1.207"));
        assert_eq!(meta.git_branch.as_deref(), Some("master"));
        assert_eq!(meta.preview, "list the files in /tmp/demo");
        assert!(meta.estimated_cost_usd > 0.0);
        assert!(!meta.is_active);
    }
}
