// Light i18n helper: English-only dictionary behind a typed t(key) so more
// locales can be added later without touching components.
const en = {
  "app.name": "OpsDeck",
  "shell.theme.toggleLight": "Switch to light theme",
  "shell.theme.toggleDark": "Switch to dark theme",
  "shell.infoPanel.toggle": "Toggle info panel",
  "shell.main.placeholder": "Select a session to view its messages",

  "projects.title": "Projects",
  "projects.empty": "No Claude Code projects found",
  "projects.emptyHint": "Sessions appear here after you use the Claude CLI.",
  "projects.error": "Could not load projects",
  "projects.sessions": "sessions",

  "sessions.empty": "No sessions",
  "sessions.emptyFiltered": "No sessions match this filter",
  "sessions.error": "Could not load sessions",
  "sessions.selectProject": "Select a project to list its sessions",
  "sessions.filter.all": "All",
  "sessions.filter.today": "Today",
  "sessions.filter.7d": "7d",
  "sessions.filter.30d": "30d",
  "sessions.filter.running": "Running",
  "sessions.active": "Active",

  "messages.empty": "No messages in this session",
  "messages.error": "Could not load session",
  "messages.malformedNotice": "lines could not be parsed and were skipped",
  "message.copy": "Copy message text",
  "message.copied": "Message copied",
  "message.copyFailed": "Could not copy to clipboard",
  "message.role.user": "User",
  "message.role.assistant": "Assistant",
  "message.tokens": "tokens",

  "thinking.label": "Thinking",
  "thinking.show": "Show thinking",
  "thinking.hide": "Hide thinking",

  "tool.input": "Input",
  "tool.result": "Result",
  "tool.error": "Error",
  "tool.showMore": "Show more",
  "tool.showLess": "Show less",
  "tool.unpairedResult": "Tool result",

  "markdown.image": "image",

  "find.placeholder": "Find in session",
  "find.noMatches": "No matches",
  "find.previous": "Previous match",
  "find.next": "Next match",
  "find.close": "Close find bar",

  "live.label": "Live",
  "live.pause": "Pause live updates",
  "live.resume": "Resume live updates",
  "sync.label": "Sync",
  "sync.tooltip": "Refresh projects and sessions now",

  "cost.estimated": "estimated",

  "inspector.empty": "Open a session to inspect it",
  "inspector.tab.files": "Files",
  "inspector.tab.changes": "Changes",
  "inspector.tab.audit": "Audit",
  "inspector.files.empty": "No files touched",
  "inspector.files.filter.all": "All",
  "inspector.files.filter.read": "Read",
  "inspector.files.filter.create": "Created",
  "inspector.files.filter.edit": "Edited",
  "inspector.files.showMore": "Show all",
  "inspector.files.showLess": "Show fewer",
  "inspector.changes.empty": "No recorded changes",
  "inspector.changes.before": "Before",
  "inspector.changes.after": "After",
  "inspector.audit.empty": "No tool calls",
  "inspector.tasks.title": "Tasks",
  "inspector.context.cwd": "Working dir",
  "inspector.context.branch": "Branch",
  "inspector.context.models": "Models",
  "inspector.context.cliVersion": "CLI",
  "inspector.context.messages": "Messages",
  "inspector.tokens.title": "Tokens",
  "inspector.tokens.input": "Input",
  "inspector.tokens.output": "Output",
  "inspector.tokens.cacheCreate": "Cache write",
  "inspector.tokens.cacheRead": "Cache read",
  "inspector.cost.title": "Estimated cost",
  "inspector.jump": "Jump to message",
} as const;

export type I18nKey = keyof typeof en;

export function t(key: I18nKey): string {
  return en[key];
}
