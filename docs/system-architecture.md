# OpsDeck System Architecture

## Overview

OpsDeck is a Tauri 2 desktop application that provides a read-only viewer for Claude Code session records stored locally in `~/.claude/projects/`. The system is built around a strict read-only constraint: the app never modifies Claude CLI data.

```
┌─────────────────────────┐
│  ~/.claude/projects/    │
│   (JSONL files)         │
│   [read-only]           │
└────────────┬────────────┘
             │
      ┌──────▼────────┐
      │  Rust Parser  │
      │  (Commands +  │
      │   Watcher)    │
      └──────┬────────┘
             │
     ┌───────▼────────┐
     │ tauri-specta   │
     │ (Type-safe     │
     │  bindings)     │
     └───────┬────────┘
             │
      ┌──────▼─────────┐
      │  React UI      │
      │  (TanStack     │
      │   Query)       │
      └────────────────┘
```

## Backend Architecture (Rust)

### Command Handlers (`src-tauri/src/commands.rs`)

Four Tauri commands expose session data:

| Command | Parameters | Returns | Purpose |
|---------|-----------|---------|---------|
| `list_projects()` | — | `ProjectSummary[]` | Enumerate all projects in ~/.claude/projects with session counts |
| `list_sessions(projectId)` | project_id: string | `SessionMeta[]` | List sessions in a project with metadata (timestamps, token usage, models) |
| `get_session(projectId, sessionId)` | project_id, session_id: strings | `SessionDetail` | Fetch full session: metadata + parsed messages + malformed line count |
| `get_pricing()` | — | `PricingTable` | Hardcoded model pricing rates (input/output/cache tokens) |

**Type Safety**: All command parameters and return types are defined in Rust with `#[derive(specta::Type)]`. The build process generates `src/lib/bindings.ts` automatically—no manual DTO mirrors.

### Session Metadata (`src-tauri/src/commands.rs` + `src-tauri/src/parser/meta.rs`)

Each session file produces:
- **session_id**: Derived from filename (stem)
- **started_at / ended_at**: ISO 8601 timestamps extracted from first/last message lines
- **message_count**: Total message records parsed
- **tokens**: Aggregated `TokenUsage` (input, output, cache_creation, cache_read) — **single source of truth**
- **estimated_cost_usd**: Sum of (tokens × model pricing) using hardcoded rates
- **models**: Array of unique model IDs used in session
- **cli_version, git_branch, cwd**: Extracted from `cwd` fields in JSONL lines
- **preview**: One-line excerpt for list display
- **is_active**: Computed from file mtime (considers session "active" if modified in last 2 hours)

Token totals are computed **once during parsing** and stored in the SessionMeta. The Inspector panel in React always displays these cached totals—never recomputed from messages. This is load-bearing: totals must always match to prevent confusion.

### JSONL Parser (`src-tauri/src/parser/`)

Four modules handle parsing:

1. **raw.rs**: Line-by-line JSONL parsing into `RawLine` structs
   - Each line is a JSON object with optional fields: `type`, `cwd`, `model`, `tokens`, `blocks`, etc.
   - Malformed lines are counted but not fatal (graceful degradation)

2. **normalize.rs**: Transform `RawLine` → `Message` (normalized DTO)
   - Flatten blocks: tool_use, text, thinking, tool_result
   - Deduplicate by message_id (last-wins): handles streamed chunks that may arrive out-of-order or duplicate
   - Strip markdown images/links for safety

3. **meta.rs**: Derive metadata from parsed structure
   - Aggregate token counts across messages
   - Extract session timestamps, models, CLI version
   - Compute estimated cost using pricing table

4. **mod.rs**: Entry point; orchestrates parsing pipeline

### File Watcher & Events (`src-tauri/src/watcher.rs`)

- Uses `notify-debouncer-mini` to listen for file changes in `~/.claude/projects/`
- 500ms debounce window to coalesce rapid edits (e.g., streaming output)
- Emits `sessions-changed` Tauri event when `.jsonl` files are added/modified
- Event payload: `{ kind: string, project_id: string, session_id: string | null }`
- Frontend auto-invalidates TanStack Query cache on event; UI refetches

### Application State (`src-tauri/src/state.rs`)

Shared mutable state (behind `Mutex`):
- **meta_cache**: In-memory LRU-style cache of SessionMeta (keyed by file path)
  - Invalidates on mtime/size change
  - Always recomputes is_active from current mtime
- **project_name_cache**: Project ID → friendly name (read from package.json or cwd basename)

### Pricing (`src-tauri/src/pricing.rs`)

Hardcoded model pricing:
```rust
ModelPricing {
    model_match: "claude-3.5-sonnet",
    input: 3.00,      // $/1M tokens
    output: 15.00,
    cache_creation: 3.75,
    cache_read: 0.30,
}
```

Rates are **approximations** (labeled "estimated" in UI) and drift over time. Not fetched live. Matched against model name via substring, first-match wins.

### Build & Type Export (`src-tauri/src/lib.rs`)

- `specta_builder()`: Collects all Rust commands and events
- Debug build: auto-exports to `src/lib/bindings.ts` with TypeScript configuration
  - bigint → number (safe for token counts)
  - eslint-disable header (generated code)
- Test: `cargo test` regenerates bindings without launching the app

## Frontend Architecture (React)

### Root Component Tree (`src/App.tsx`)

```
<App>
  <QueryClientProvider>           # TanStack Query
    <ThemeProvider>
      <TooltipProvider>           # shadcn/ui
        <SelectionProvider>        # Current project/session state
          <LiveRefreshProvider>    # File watcher invalidation
            <MessageJumpProvider>  # Message scroll-to-target
              <AppShell>
                <ProjectSidebar /> (left column)
                <MainPane>
                  <SessionList />  (middle column)
                  <MessageView />  (main content)
                </MainPane>
                <InfoPanel />      (right column, collapsible)
                <Toaster />        # Toast notifications
```

### Feature Modules

#### Projects (`src/features/projects/`)
- **project-sidebar.tsx**: Hierarchical project list with session count badges
- Clicking a project highlights it; clicking again expands/collapses sessions

#### Sessions (`src/features/sessions/`)
- **session-list.tsx**: Virtualized list of sessions for the selected project
- **session-row.tsx**: Single row with icon, title (preview), timestamp, token count, is-active indicator
- **session-filters.ts**: Predicate functions for sorting/filtering (by date, token range, model)
- Clicking a session populates MessageView

#### Messages (`src/features/messages/`)
- **message-view.tsx**: Main panel; renders selected session's messages
- **message-item.tsx**: Single message (role + all blocks)
- **message-text.ts**: Transform block content → markdown → React tree
- **find-bar.tsx**: Cmd+F search within session (client-side only, no backend index)
- **tool-meta.ts**: Extract token usage from tool_result blocks
- **blocks/**: Specialized renderers for text, thinking, tool_use, tool_result, markdown, terminal output

#### Inspector (`src/features/inspector/`)
- **info-panel.tsx**: Collapsible right panel with tabbed sections
- **overview-strip.tsx**: Session title, duration, model list, total tokens/cost
- **token-grid.tsx**: 2D table (rows: models, cols: input/output/cache_creation/cache_read tokens) with totals
  - Totals are read from SessionMeta (never recomputed)
- Tabs: Overview, Files, Changes, Audit, Tasks (placeholder structure; content depends on message blocks)

### Data Access Layer (`src/lib/ipc.ts`)

TypeScript wrappers around generated Tauri bindings:
```typescript
export async function listProjects() { ... }
export async function listSessions(projectId: string) { ... }
export async function getSession(projectId: string, sessionId: string) { ... }
```

TanStack Query consumes these; results cached by default with 60s staleness threshold.

### Hooks & Context

- **useSelection()**: Current project/session context (global state)
- **useLiveRefresh()**: Subscribe to sessions-changed events; auto-invalidate queries
- **useMessageJump()**: Scroll target when user searches/filters
- **useFind()**: Find-bar state machine (search term, match index, total matches)

### Markdown & Code Rendering

- **react-markdown** with `remark-gfm` plugin for GitHub-flavored blocks
- **Syntax highlighting**: Inline language detection via code fence lang attribute
- **Safety**: Links and images are neutralized:
  - Links render as plain text (no href)
  - Images render as alt text (no src)
  - Prevents navigation/outbound fetches from transcripts

### Theming (`src/components/theme/`)

- Light and dark CSS variables injected by Tailwind v4
- Theme toggle in app shell; persists to localStorage
- All colors bound to CSS variables for consistent switching

### Internationalization (`src/lib/i18n.ts`)

Simple key-based helper:
```typescript
export const t = (key: string) => translations[key] ?? key;
```

Object structure:
```typescript
const translations = {
  "sidebar.projects": "Projects",
  "find.no-results": "No matches found",
  // ... more keys
};
```

Add new strings by adding key → English string to this object. Future: swap object for language-specific JSON files.

## Type Safety & Code Generation

### tauri-specta Contract

Rust source-of-truth → TypeScript codegen:

1. Rust structs: `#[derive(specta::Type)]`
2. Build artifact: `src-tauri/src/lib.rs` exports bindings during debug build
3. Generated output: `src/lib/bindings.ts` (auto-formatted, no manual edits)
4. Frontend: Import from `bindings.ts` for parameter/response types

Benefits:
- Drift-proof: if a Rust type changes, the TS build breaks immediately
- No redundant DTOs: single definition in Rust
- Generated command wrappers use strict types

## Data Flow Examples

### User Opens Session

1. Frontend: `await getSession(projectId, sessionId)`
2. Tauri (Rust): `commands::get_session(projectId, sessionId)`
3. Rust:
   - Validate IDs (no path traversal)
   - Read `.jsonl` file from `~/.claude/projects/{projectId}/{sessionId}.jsonl`
   - Parse JSONL lines → RawLine structs
   - Normalize RawLine → Message (deduplicate, strip images)
   - Derive SessionMeta from messages
   - Return `SessionDetail { meta, messages, malformed_lines }`
4. Frontend:
   - TanStack Query caches result
   - React renders MessageView with virtualized list
   - Inspector displays meta.tokens in token grid

### File Watcher Detects Change

1. Rust watcher observes mtime change in `.jsonl` file
2. Emits `sessions-changed` event to frontend
3. Frontend: `LiveRefreshProvider` listener fires; invalidates TanStack Query
4. React re-fetches `list_sessions` for that project
5. SessionList re-renders with updated counts/timestamps

## Key Invariants

### Read-Only Access

- Frontend never writes to `~/.claude`
- No file operations except read from Tauri commands
- No IPC for write/delete/rename

### Path Traversal Protection

- All session IDs validated in Rust with `validate_id(id)`
- Rejects IDs containing `/`, `\`, or `..`
- Prevents directory escape (e.g., `../../etc/passwd`)

### Markdown Safety

- All markdown links and images from transcripts stripped/neutralized
- No outbound network calls from rendered content
- Prevents tracker embeds, image exfiltration, social engineering

### Token Totals Consistency

- SessionMeta computed once during parsing (single point of calculation)
- Inspector always displays cached values
- Frontend never recalculates; always matches server truth
- Error: if grid cells don't sum to total, it indicates a parse bug (triggers investigation)

### Session Metadata Accuracy

- All timestamps extracted from JSON; never guessed
- Token counts aggregated from message records
- is_active recomputed on every query (based on current mtime) to avoid stale "active" status

## Performance Considerations

### Virtualization

- SessionList and MessageView use `@tanstack/react-virtual` for 1000+ records
- Only visible rows rendered; scrolling swaps in/out DOM nodes
- Reduces memory footprint and improves scroll smoothness

### Caching Strategy

- TanStack Query: default staleness 60s, caches by (projectId, sessionId)
- Rust meta_cache: in-memory LRU keyed by file path; invalidates on mtime/size
- Project name cache: lazy-loaded once per project; never evicted

### Debounce

- File watcher: 500ms to coalesce rapid file changes
- Reduces redundant parses during active session recording

### Parsing Efficiency

- Line-by-line JSONL: streaming parser (not loading entire file into memory)
- Dedupe by message_id: last-write-wins to handle out-of-order streamed chunks
- Early return on validation failure (malformed lines don't block rest of session)

## Deferred Architectural Decisions (Future Phases)

### Overlay Database (SQLite)

Planned for storing mutable metadata alongside `.jsonl` files:
- Aliases (user-friendly session names)
- Tags and bookmarks
- Archive/trash status
- Checkpoints and notes
- Would not modify `.jsonl` files; entirely separate database

### Full-Text Search (FTS5)

Planned secondary index for keyword search:
- FTS5 index built during import
- Saved searches (queries + filters)
- Would be optional (view works without it)

### Job Execution & Live Chat

Deferred indefinitely (out of MVP scope):
- Spawning `claude` CLI commands
- Live message streaming
- Job status tracking
- Config overrides per session

## Testing

### Frontend (`pnpm test`)

- vitest: unit tests for message parsing, filters, i18n, tool metadata extraction
- No E2E in MVP (interactive walkthrough left to user)

### Backend (`cargo test -p opsdeck`)

- Unit tests for JSONL parsing, deduplication, metadata derivation
- Tests use fixture `.jsonl` files in repo
- `TypescriptBindingsExport` test verifies bindings regenerate without errors

## Security Posture

| Threat | Mitigation |
|--------|-----------|
| Path traversal | Rust-side ID validation |
| Script injection | Markdown neutralization (links/images disabled) |
| Exfiltration via images | No outbound network from parsed content |
| Unauthorized file access | App runs as current user; uses OS permissions on `~/.claude` |
| Type confusion | tauri-specta codegen (Rust source-of-truth) |

## Deployment & Distribution

### Development

```bash
pnpm tauri dev  # Vite dev server + Rust hot-reload
```

### Production

```bash
pnpm tauri build  # Generates macOS .app bundle and DMG installer
```

Distribution: macOS App Store or direct download (.dmg). Signature verification handled by Tauri framework.

## References

- Tauri 2.x docs: https://tauri.app
- tauri-specta: https://github.com/oscartbeaumont/tauri-specta
- React 19: https://react.dev
- TanStack Query: https://tanstack.com/query/latest
- Tailwind CSS v4: https://tailwindcss.com
- shadcn/ui: https://ui.shadcn.com
