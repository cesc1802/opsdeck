// Matches CSI sequences (colors, cursor movement) and OSC sequences
// (hyperlinks, titles; BEL-terminated) so terminal output renders as plain
// text. Escape chars written as \u escapes to keep this file ASCII-clean.
const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*",
    "(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)",
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join(""),
  "g",
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}
