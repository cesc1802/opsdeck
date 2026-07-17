//! Self-contained HTML export: inline CSS derived from the app's design
//! tokens (light + dark via prefers-color-scheme), system font stack, and
//! zero external resource references. Every transcript string is escaped
//! before templating.

use crate::commands::SessionDetail;
use crate::parser::normalize::Block;

use super::render_markdown::clamp_result;

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

const STYLE: &str = r#"
:root {
  --bg: #F6F3EC; --surface: #FFFCF6; --border: #E6DED0;
  --text: #2A241A; --text-secondary: #6F6454; --text-muted: #9D927F;
  --accent: #B26D2F; --accent-subtle: rgba(178, 109, 47, 0.10);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111112; --surface: #1A1B1E; --border: #2D2F35;
    --text: #F5EFE4; --text-secondary: #C4B7A3; --text-muted: #8D8478;
    --accent: #E0A15F; --accent-subtle: rgba(224, 161, 95, 0.12);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem; background: var(--bg); color: var(--text);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 48rem; margin: 0 auto; }
h1 { font-size: 1.25rem; margin: 0 0 1rem; }
.meta {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 1.5rem;
  font-size: 0.85rem; color: var(--text-secondary);
}
.meta dt { float: left; clear: left; width: 8rem; font-weight: 600; }
.meta dd { margin: 0 0 0.15rem 8.5rem; overflow-wrap: anywhere; }
.msg {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 0.75rem 1rem; margin-bottom: 0.75rem;
}
.msg.user { border-left: 3px solid var(--accent); }
.msg header {
  display: flex; justify-content: space-between; gap: 0.5rem;
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-muted); margin-bottom: 0.5rem;
}
.msg .text { white-space: pre-wrap; overflow-wrap: anywhere; }
blockquote {
  margin: 0.5rem 0; padding: 0.25rem 0.75rem; white-space: pre-wrap;
  border-left: 3px solid var(--border); color: var(--text-secondary);
  font-style: italic;
}
.tool { margin: 0.75rem 0; }
.tool-name {
  font-size: 0.8rem; font-weight: 600; color: var(--accent);
  margin-bottom: 0.25rem;
}
pre {
  background: var(--accent-subtle); border: 1px solid var(--border);
  border-radius: 8px; padding: 0.6rem 0.8rem; overflow-x: auto;
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.35rem 0;
}
pre.error { border-color: #b3564a; }
.estimated { color: var(--text-muted); font-size: 0.75rem; }
"#;

fn push_meta_row(out: &mut String, label: &str, value: &str) {
    out.push_str(&format!(
        "<dt>{}</dt><dd>{}</dd>",
        escape(label),
        escape(value)
    ));
}

pub fn render(detail: &SessionDetail) -> String {
    let meta = &detail.meta;
    let mut out = String::new();

    out.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
    out.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    out.push_str(&format!(
        "<title>Session {}</title>\n",
        escape(&meta.session_id)
    ));
    out.push_str("<style>");
    out.push_str(STYLE);
    out.push_str("</style>\n</head>\n<body>\n<main>\n");

    out.push_str(&format!("<h1>Session {}</h1>\n", escape(&meta.session_id)));
    out.push_str("<dl class=\"meta\">");
    push_meta_row(&mut out, "Project", &meta.project_id);
    if let Some(started) = &meta.started_at {
        push_meta_row(&mut out, "Started", started);
    }
    if let Some(ended) = &meta.ended_at {
        push_meta_row(&mut out, "Ended", ended);
    }
    push_meta_row(&mut out, "Messages", &meta.message_count.to_string());
    push_meta_row(&mut out, "Tokens", &meta.tokens.total().to_string());
    out.push_str(&format!(
        "<dt>Cost</dt><dd>${:.2} <span class=\"estimated\">(estimated)</span></dd>",
        meta.estimated_cost_usd
    ));
    if !meta.models.is_empty() {
        push_meta_row(&mut out, "Models", &meta.models.join(", "));
    }
    if let Some(branch) = &meta.git_branch {
        push_meta_row(&mut out, "Branch", branch);
    }
    if let Some(cwd) = &meta.cwd {
        push_meta_row(&mut out, "Directory", cwd);
    }
    out.push_str("</dl>\n");

    for message in &detail.messages {
        let role_class = if message.role == "user" {
            "user"
        } else {
            "assistant"
        };
        out.push_str(&format!(
            "<article class=\"msg {role_class}\">\n<header><span>{}</span>",
            escape(&message.role)
        ));
        if let Some(ts) = &message.timestamp {
            out.push_str(&format!("<span>{}</span>", escape(ts)));
        }
        out.push_str("</header>\n");
        for block in &message.blocks {
            match block {
                Block::Text { text } => {
                    out.push_str(&format!("<div class=\"text\">{}</div>\n", escape(text)));
                }
                Block::Thinking { thinking } => {
                    out.push_str(&format!("<blockquote>{}</blockquote>\n", escape(thinking)));
                }
                Block::ToolUse {
                    name,
                    input,
                    result,
                    ..
                } => {
                    out.push_str("<section class=\"tool\">\n");
                    out.push_str(&format!(
                        "<div class=\"tool-name\">Tool: {}</div>\n",
                        escape(name)
                    ));
                    let pretty =
                        serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
                    out.push_str(&format!("<pre>{}</pre>\n", escape(&pretty)));
                    if let Some(info) = result {
                        let class = if info.is_error {
                            " class=\"error\""
                        } else {
                            ""
                        };
                        out.push_str(&format!(
                            "<pre{class}>{}</pre>\n",
                            escape(&clamp_result(&info.content))
                        ));
                    }
                    out.push_str("</section>\n");
                }
                Block::ToolResult {
                    is_error, content, ..
                } => {
                    let class = if *is_error { " class=\"error\"" } else { "" };
                    out.push_str(&format!(
                        "<pre{class}>{}</pre>\n",
                        escape(&clamp_result(content))
                    ));
                }
            }
        }
        out.push_str("</article>\n");
    }

    out.push_str("</main>\n</body>\n</html>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::test_fixtures::sample_detail;

    #[test]
    fn contains_no_external_resource_references() {
        let html = render(&sample_detail());
        assert!(!html.contains("http://"), "unexpected http:// reference");
        assert!(!html.contains("https://"), "unexpected https:// reference");
        assert!(!html.contains("url("), "unexpected css url() reference");
    }

    #[test]
    fn escapes_transcript_content_including_script_tags() {
        let mut detail = sample_detail();
        detail.messages[0].blocks = vec![crate::parser::normalize::Block::Text {
            text: "<script>alert('pwned')</script>".into(),
        }];
        let html = render(&detail);
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;alert(&#39;pwned&#39;)&lt;/script&gt;"));
    }

    #[test]
    fn supports_both_themes_via_media_query() {
        let html = render(&sample_detail());
        assert!(html.contains("prefers-color-scheme: dark"));
        assert!(html.contains("#F6F3EC"), "light background token missing");
        assert!(html.contains("#111112"), "dark background token missing");
    }

    #[test]
    fn labels_cost_as_estimated() {
        let html = render(&sample_detail());
        assert!(html.contains("$0.42 <span class=\"estimated\">(estimated)</span>"));
    }
}
