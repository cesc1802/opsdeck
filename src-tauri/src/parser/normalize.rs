use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::raw::RawLine;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, specta::Type)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
    }

    pub fn add(&mut self, other: &TokenUsage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_creation_input_tokens += other.cache_creation_input_tokens;
        self.cache_read_input_tokens += other.cache_read_input_tokens;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ToolResultInfo {
    pub is_error: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
        /// Result paired from a later user-role line via tool_use_id.
        result: Option<ToolResultInfo>,
    },
    /// A tool result whose tool_use was never seen (kept unpaired).
    ToolResult {
        tool_use_id: String,
        is_error: bool,
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Message {
    /// Line uuid; None when the CLI omitted it.
    pub uuid: Option<String>,
    /// API message id (shared by streamed chunks of one assistant turn).
    pub message_id: Option<String>,
    pub role: String,
    pub timestamp: Option<String>,
    pub model: Option<String>,
    pub usage: Option<TokenUsage>,
    pub blocks: Vec<Block>,
}

pub(crate) fn usage_from_raw(raw: &super::raw::RawUsage) -> TokenUsage {
    TokenUsage {
        input_tokens: raw.input_tokens.unwrap_or(0),
        output_tokens: raw.output_tokens.unwrap_or(0),
        cache_creation_input_tokens: raw.cache_creation_input_tokens.unwrap_or(0),
        cache_read_input_tokens: raw.cache_read_input_tokens.unwrap_or(0),
    }
}

/// Flatten tool_result content (string, or array of text blocks) to a string.
fn result_content_to_string(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

struct PendingResult {
    is_error: bool,
    content: String,
}

fn content_blocks(content: &Value, pending_results: &mut HashMap<String, PendingResult>) -> Vec<Block> {
    match content {
        Value::String(text) => {
            if text.is_empty() {
                vec![]
            } else {
                vec![Block::Text { text: text.clone() }]
            }
        }
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let block_type = item.get("type").and_then(Value::as_str)?;
                match block_type {
                    "text" => Some(Block::Text {
                        text: item.get("text").and_then(Value::as_str)?.to_string(),
                    }),
                    "thinking" => Some(Block::Thinking {
                        thinking: item.get("thinking").and_then(Value::as_str)?.to_string(),
                    }),
                    "tool_use" => Some(Block::ToolUse {
                        id: item
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        name: item
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown")
                            .to_string(),
                        input: item.get("input").cloned().unwrap_or(Value::Null),
                        result: None,
                    }),
                    "tool_result" => {
                        let tool_use_id = item
                            .get("tool_use_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let is_error = item
                            .get("is_error")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        let content = item
                            .get("content")
                            .map(result_content_to_string)
                            .unwrap_or_default();
                        if tool_use_id.is_empty() {
                            return None;
                        }
                        pending_results.insert(
                            tool_use_id.clone(),
                            PendingResult {
                                is_error,
                                content: content.clone(),
                            },
                        );
                        Some(Block::ToolResult {
                            tool_use_id,
                            is_error,
                            content,
                        })
                    }
                    // Unknown block types are ignored by design.
                    _ => None,
                }
            })
            .collect(),
        _ => vec![],
    }
}

/// Normalize raw lines into ordered messages with tool_use <-> tool_result
/// pairing. Tool results arrive inside later user-role lines; each one is
/// attached onto its ToolUse block, and the standalone ToolResult copy is
/// dropped. User messages left empty by that extraction are dropped too.
pub fn normalize(lines: &[RawLine]) -> Vec<Message> {
    let mut messages: Vec<Message> = Vec::new();
    // tool_use_id -> (message index, block index) of the ToolUse block
    let mut tool_use_index: HashMap<String, (usize, usize)> = HashMap::new();
    let mut pending_results: HashMap<String, PendingResult> = HashMap::new();

    for line in lines {
        if line.is_meta.unwrap_or(false) {
            continue;
        }
        let line_type = line.line_type.as_deref().unwrap_or("");
        if line_type != "user" && line_type != "assistant" {
            continue;
        }
        let Some(message) = &line.message else {
            continue;
        };
        let role = message
            .role
            .clone()
            .unwrap_or_else(|| line_type.to_string());
        let Some(content) = &message.content else {
            continue;
        };

        let blocks = content_blocks(content, &mut pending_results);
        let msg = Message {
            uuid: line.uuid.clone(),
            message_id: message.id.clone(),
            role,
            timestamp: line.timestamp.clone(),
            model: message.model.clone(),
            usage: message.usage.as_ref().map(usage_from_raw),
            blocks,
        };
        let msg_index = messages.len();
        for (block_index, block) in msg.blocks.iter().enumerate() {
            if let Block::ToolUse { id, .. } = block {
                if !id.is_empty() {
                    tool_use_index.insert(id.clone(), (msg_index, block_index));
                }
            }
        }
        messages.push(msg);
    }

    // Attach each result to its tool_use block.
    let mut paired_ids: Vec<String> = Vec::new();
    for (tool_use_id, pending) in &pending_results {
        if let Some(&(msg_index, block_index)) = tool_use_index.get(tool_use_id) {
            if let Block::ToolUse { result, .. } = &mut messages[msg_index].blocks[block_index] {
                *result = Some(ToolResultInfo {
                    is_error: pending.is_error,
                    content: pending.content.clone(),
                });
                paired_ids.push(tool_use_id.clone());
            }
        }
    }

    // Drop the standalone ToolResult copies that were successfully paired,
    // then drop messages that end up with no blocks at all.
    for msg in &mut messages {
        msg.blocks.retain(|block| match block {
            Block::ToolResult { tool_use_id, .. } => !paired_ids.contains(tool_use_id),
            _ => true,
        });
    }
    messages.retain(|msg| !msg.blocks.is_empty());

    messages
}

/// Parse raw JSONL text into (raw lines, malformed count).
pub fn parse_raw_lines(text: &str) -> (Vec<RawLine>, u32) {
    let mut raw_lines = Vec::new();
    let mut malformed = 0u32;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match super::raw::parse_line(trimmed) {
            Some(raw) => raw_lines.push(raw),
            None => malformed += 1,
        }
    }
    (raw_lines, malformed)
}
