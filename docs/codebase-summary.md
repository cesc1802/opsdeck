# OpsDeck Codebase Summary

## Project Overview

OpsDeck is a Tauri 2 + React + TypeScript desktop application that combines session history viewing with live interactive chat. It serves dual purposes:

1. **Read-only session viewer**: Browse and analyze Claude CLI session records stored in `~/.claude/projects/`
2. **Live chat interface**: Start new promptless chat sessions, send messages with slash command autocomplete, and manage job lifecycle

## Architecture at a Glance

```
Backend (Rust/Tauri)              Frontend (React/TypeScript)
├── Session parsing               ├── Project sidebar
├── File watching                 ├── Session list
├── Job execution                 ├── Chat composer with slash completion
├── Completion scanning           ├── Message viewer
└── Type generation → bindings    └── Inspector panel
```

## Backend Structure (`src-tauri/src/`)

### Core Modules

| Module | Purpose |
|--------|---------|
| `commands.rs` | Tauri IPC handlers: list_projects, list_sessions, get_session, get_pricing, fetch_completions |
| `jobs/mod.rs` | Job lifecycle: spawn, events, status tracking |
| `jobs/options.rs` | LaunchOptions struct; chat configuration and validation |
| `jobs/completions.rs` | Filesystem scanner for slash commands, skills, and agents |
| `jobs/events.rs` | Event bridge from CLI stream-json to app events |
| `parser/` | JSONL parsing: raw.rs, normalize.rs, meta.rs |
| `state.rs` | Shared mutable state: metadata cache, project name cache |
| `watcher.rs` | File change detection on `~/.claude/projects/` |
| `profiles/` | Saved launch profiles (cwd, model, options, hooks) |
| `pricing.rs` | Hardcoded model pricing rates |

### Key Types

- **LaunchOptions**: Full chat configuration (cwd, prompt [optional/empty], model, tools, hooks, etc.)
- **JobEventPayload**: Normalized event enum (SessionStarted, UserMessage, TextDelta, ToolUse, etc.)
- **CompletionCatalog**: Lists of commands, skills, and agents discovered on disk
- **SessionMeta**: Parsed session metadata (token counts, models, timestamps, cost)

## Frontend Structure (`src/`)

### Feature Directories

| Module | Purpose |
|--------|---------|
| `features/projects/` | Project sidebar: list, icons, session count badges |
| `features/sessions/` | Session list view with filters and virtualization |
| `features/messages/` | Message display, syntax highlighting, find-bar |
| `features/chat/` | Live chat: composer, slash completion, job display |
| `features/inspector/` | Right panel: session metadata, token grid, overview |
| `features/profiles/` | Profile editor: save/load launch configurations |
| `lib/` | Utilities: IPC wrappers (ipc.ts), hooks, i18n, query keys |
| `components/` | Reusable UI: buttons, forms, theme, shell layout |

### Chat Feature Components

- **chat-composer.tsx**: Textarea with slash completion popup, send/interrupt buttons
- **slash-completion.ts**: Pure logic for token detection, filtering, catalog merging
- **job-display.tsx**: Status indicator and job controls (pause, resume)
- **chat-timeline-reducer.ts**: Message buffer state machine

## Data Flows

### Starting a New Chat (Promptless)

1. User opens New Chat form → selects project via picker (no prompt field)
2. Form calls `startJob(LaunchOptions { cwd, prompt: "" })` (empty prompt)
3. Tauri command spawns `claude` CLI with stdin/stdout piping
4. CLI outputs `{"type":"system","subtype":"init",...,"slash_commands":[...],"agents":[...]}`
5. Frontend receives SessionStarted event with slash_commands/agents arrays
6. Composer becomes active (status="starting"), waits for user's first message
7. User types in composer → sends via `sendUserMessage(jobId, text)`
8. Job transitions to "running" after CLI processes first turn

### Slash Autocomplete

1. User types `/` at message start or after whitespace
2. Composer queries `fetchCompletions(cwd)` → calls `list_completions` Tauri command
3. Tauri scans `~/.claude` and `<cwd>/.claude` for commands/skills/agents
4. Results merged with SessionStarted event's slash_commands/agents
5. Popup filters by prefix, keyboard-navigable (↑↓/Enter/Esc)
6. On selection: replaces token with `/name ` (trailing space)

## Type Safety & Code Generation

- **tauri-specta**: Rust struct → TypeScript type codegen at build time
- **Bindings**: Auto-generated `src/lib/bindings.ts`; never edited manually
- Drift detection: TS build fails if Rust types change unexpectedly

## Session File Format

Session files: `~/.claude/projects/<project-id>/<session-id>.jsonl`

Each line is a JSON object:
```json
{"type":"system","subtype":"init","model":"claude-sonnet-5","session_id":"ses_...","slash_commands":["cook","review"],"agents":["debugger"]}
{"type":"user","message":{"content":[{"type":"text","text":"hello"}]}}
{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"text"}}}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}
```

## Deployment

- **Dev**: `pnpm tauri dev` (hot reload on code changes)
- **Build**: `pnpm tauri build` (macOS .app + .dmg)
- **Distribution**: Direct download or App Store

## Key Invariants

- **Read-only for history**: Frontend never modifies `~/.claude/projects/`
- **Path traversal protection**: All session IDs validated server-side
- **Markdown safety**: Links/images from transcripts neutralized
- **Token consistency**: SessionMeta computed once, cached always
- **Promptless default**: Empty LaunchOptions.prompt spawns CLI with no initial prompt
- **Async completions**: Filesystem scan (instant) + session init event (delayed) merged

## Testing

- **Frontend**: vitest (unit tests for parsing, filters, completion logic)
- **Backend**: cargo test (JSONL parsing, metadata, completions, event bridge)
- **Fixtures**: Stream JSON samples in `tests/fixtures/`

## Dependencies

### Frontend
- React 19, TypeScript 5
- TanStack Query (caching), TanStack React Virtual (virtualization)
- Tauri (IPC bridge)
- Tailwind CSS v4, shadcn/ui (components)
- react-markdown, remark-gfm (rendering)
- Sonner (toast notifications)

### Backend
- Tauri 2, tauri-specta (codegen)
- serde (JSON), tokio (async)
- notify-debouncer-mini (file watching)
- Regex, dirs, walkdir (filesystem)

## Configuration Files

- `src-tauri/tauri.conf.json`: App manifest, build config
- `.env`: Runtime environment (DEBUG_APP, etc.)
- `package.json`: Frontend dependencies and scripts
- `Cargo.toml`: Backend dependencies

## Documentation Files

- `docs/system-architecture.md`: Detailed technical design
- `docs/code-standards.md`: Coding conventions (if exists)
- `README.md`: User-facing quick start and feature overview
