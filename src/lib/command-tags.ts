// User-role lines from the CLI wrap slash commands and their local output in
// pseudo-XML tags. This splits raw text into renderable segments: command
// chips, terminal output, plain text. Caveat/message wrappers are dropped.
export type UserTextSegment =
  | { kind: "command"; name: string; args: string }
  | { kind: "stdout"; text: string }
  | { kind: "text"; text: string };

const TAG_PATTERN =
  /<(command-name|command-message|command-args|command-contents|local-command-stdout|local-command-stderr|local-command-caveat)>([\s\S]*?)(?:<\/\1>|$)/g;

export function parseUserText(raw: string): UserTextSegment[] {
  const segments: UserTextSegment[] = [];
  let lastIndex = 0;
  let pendingCommand: { name: string; args: string } | null = null;

  const flushCommand = () => {
    if (pendingCommand) {
      segments.push({ kind: "command", ...pendingCommand });
      pendingCommand = null;
    }
  };
  const pushText = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) {
      flushCommand();
      segments.push({ kind: "text", text: trimmed });
    }
  };

  TAG_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(TAG_PATTERN)) {
    pushText(raw.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const [, tag, content] = match;
    switch (tag) {
      case "command-name":
        flushCommand();
        pendingCommand = { name: content.trim(), args: "" };
        break;
      case "command-args":
        if (pendingCommand) {
          pendingCommand.args = content.trim();
        } else if (content.trim()) {
          segments.push({ kind: "text", text: content.trim() });
        }
        break;
      case "local-command-stdout":
      case "local-command-stderr": {
        flushCommand();
        const text = content.trim();
        if (text) {
          segments.push({ kind: "stdout", text });
        }
        break;
      }
      // command-message duplicates the command name; caveat is CLI
      // boilerplate; command-contents wraps prompt bodies we show as text.
      case "command-contents":
        pushText(content);
        break;
      default:
        break;
    }
  }
  pushText(raw.slice(lastIndex));
  flushCommand();

  return segments;
}
