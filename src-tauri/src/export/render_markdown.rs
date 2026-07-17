use crate::commands::SessionDetail;
use crate::parser::normalize::Block;

pub const RESULT_CLAMP: usize = 4000;
pub const TRUNCATION_MARKER: &str = "… [truncated]";

/// Clamp long tool output for readable exports (full text stays in the
/// JSON format).
pub fn clamp_result(content: &str) -> String {
    if content.chars().count() <= RESULT_CLAMP {
        return content.to_string();
    }
    let mut clamped: String = content.chars().take(RESULT_CLAMP).collect();
    clamped.push_str(TRUNCATION_MARKER);
    clamped
}

/// A fence longer than any backtick run inside the content, so embedded
/// code blocks cannot break out.
fn fence_for(content: &str) -> String {
    let mut longest = 0usize;
    let mut run = 0usize;
    for ch in content.chars() {
        if ch == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    "`".repeat((longest + 1).max(3))
}

fn fenced(out: &mut String, lang: &str, content: &str) {
    let fence = fence_for(content);
    out.push_str(&fence);
    out.push_str(lang);
    out.push('\n');
    out.push_str(content);
    if !content.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&fence);
    out.push_str("\n\n");
}

fn role_title(role: &str) -> String {
    let mut chars = role.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

pub fn render(detail: &SessionDetail) -> String {
    let meta = &detail.meta;
    let mut out = String::new();

    out.push_str(&format!("# Session {}\n\n", meta.session_id));
    out.push_str(&format!("- Project: {}\n", meta.project_id));
    if let Some(started) = &meta.started_at {
        out.push_str(&format!("- Started: {started}\n"));
    }
    if let Some(ended) = &meta.ended_at {
        out.push_str(&format!("- Ended: {ended}\n"));
    }
    out.push_str(&format!("- Messages: {}\n", meta.message_count));
    out.push_str(&format!(
        "- Tokens: {} (input {}, output {}, cache write {}, cache read {})\n",
        meta.tokens.total(),
        meta.tokens.input_tokens,
        meta.tokens.output_tokens,
        meta.tokens.cache_creation_input_tokens,
        meta.tokens.cache_read_input_tokens
    ));
    out.push_str(&format!(
        "- Cost: ${:.2} (estimated)\n",
        meta.estimated_cost_usd
    ));
    if !meta.models.is_empty() {
        out.push_str(&format!("- Models: {}\n", meta.models.join(", ")));
    }
    if let Some(branch) = &meta.git_branch {
        out.push_str(&format!("- Branch: {branch}\n"));
    }
    if let Some(cwd) = &meta.cwd {
        out.push_str(&format!("- Directory: {cwd}\n"));
    }
    out.push('\n');

    for message in &detail.messages {
        out.push_str("---\n\n");
        match &message.timestamp {
            Some(ts) => out.push_str(&format!("## {} — {ts}\n\n", role_title(&message.role))),
            None => out.push_str(&format!("## {}\n\n", role_title(&message.role))),
        }
        for block in &message.blocks {
            match block {
                Block::Text { text } => {
                    out.push_str(text);
                    out.push_str("\n\n");
                }
                Block::Thinking { thinking } => {
                    for line in thinking.lines() {
                        out.push_str("> ");
                        out.push_str(line);
                        out.push('\n');
                    }
                    out.push('\n');
                }
                Block::ToolUse {
                    name,
                    input,
                    result,
                    ..
                } => {
                    out.push_str(&format!("### Tool: {name}\n\n"));
                    out.push_str("**Input**\n\n");
                    let pretty =
                        serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
                    fenced(&mut out, "json", &pretty);
                    if let Some(info) = result {
                        if info.is_error {
                            out.push_str("**Result (error)**\n\n");
                        } else {
                            out.push_str("**Result**\n\n");
                        }
                        fenced(&mut out, "", &clamp_result(&info.content));
                    }
                }
                Block::ToolResult {
                    tool_use_id,
                    is_error,
                    content,
                } => {
                    if *is_error {
                        out.push_str(&format!("### Tool result (error, {tool_use_id})\n\n"));
                    } else {
                        out.push_str(&format!("### Tool result ({tool_use_id})\n\n"));
                    }
                    fenced(&mut out, "", &clamp_result(content));
                }
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::test_fixtures::sample_detail;

    #[test]
    fn renders_meta_messages_and_tool_blocks() {
        let md = render(&sample_detail());
        assert!(md.starts_with("# Session sess-1\n"));
        assert!(md.contains("- Cost: $0.42 (estimated)"));
        assert!(md.contains("## User — 2026-07-14T09:00:00Z"));
        assert!(md.contains("## Assistant — 2026-07-14T09:00:05Z"));
        assert!(md.contains("> weighing the options"));
        assert!(md.contains("### Tool: Bash"));
        assert!(md.contains("**Input**"));
        assert!(md.contains("**Result**"));
    }

    #[test]
    fn clamps_long_results_with_a_visible_marker() {
        let long = "x".repeat(RESULT_CLAMP + 500);
        let clamped = clamp_result(&long);
        assert!(clamped.ends_with(TRUNCATION_MARKER));
        assert_eq!(
            clamped.chars().count(),
            RESULT_CLAMP + TRUNCATION_MARKER.chars().count()
        );
        let short = "short output";
        assert_eq!(clamp_result(short), short);
    }

    #[test]
    fn embedded_backtick_fences_cannot_escape_the_code_block() {
        let mut out = String::new();
        fenced(&mut out, "", "inner\n```\nescape attempt\n```");
        assert!(
            out.starts_with("````\n"),
            "fence should outgrow content: {out}"
        );
        assert!(out.trim_end().ends_with("````"));
    }

    #[test]
    fn output_is_deterministic() {
        let detail = sample_detail();
        assert_eq!(render(&detail), render(&detail));
    }
}
