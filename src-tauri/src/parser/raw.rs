use serde::Deserialize;
use serde_json::Value;

/// One raw JSONL line. Every non-essential field is optional so the parser
/// survives unknown `type` values and future CLI schema changes.
#[derive(Debug, Clone, Deserialize)]
pub struct RawLine {
    #[serde(rename = "type")]
    pub line_type: Option<String>,
    pub message: Option<RawMessage>,
    pub uuid: Option<String>,
    pub timestamp: Option<String>,
    pub cwd: Option<String>,
    pub version: Option<String>,
    #[serde(rename = "gitBranch")]
    pub git_branch: Option<String>,
    #[serde(rename = "isMeta")]
    pub is_meta: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawMessage {
    pub id: Option<String>,
    pub role: Option<String>,
    /// String for plain user text, array of blocks otherwise.
    pub content: Option<Value>,
    pub model: Option<String>,
    pub usage: Option<RawUsage>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

/// Parse one JSONL line. Returns None for malformed JSON or lines that are
/// valid JSON but not an object (both counted as malformed by callers).
pub fn parse_line(line: &str) -> Option<RawLine> {
    serde_json::from_str::<RawLine>(line).ok()
}
