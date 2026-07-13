# OpsDeck

A macOS-first desktop app for browsing and inspecting Claude Code session records. OpsDeck is a read-only viewer for the local session data stored in `~/.claude/projects/`, displaying conversations, token usage, estimated costs, and file context.

## Features

- **Session Browsing**: Browse projects and sessions with search/filter support
- **Message Viewer**: Virtualized message display with syntax-highlighted code blocks and markdown rendering
- **Find in Session**: Cmd+F search within large conversations (no backend indexing)
- **Context Inspector**: View file changes, audit logs, task records, and token usage by model
- **Live Refresh**: File watcher detects new/updated sessions automatically (~500ms debounce)
- **Dark/Light Theme**: System-aware theme switching with UI controls
- **Internationalization**: English by default; light `t(key)` helper for future translations

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query
- **Backend**: Rust, Tauri 2, file watcher (`notify-debouncer-mini`), tauri-specta for type-safe IPC
- **Build**: pnpm, Cargo

## Prerequisites

- Node.js 22+ and pnpm 10+
- Rust stable (via `rustup`); Tauri CLI installed via `npm install -g @tauri-apps/cli@2`
- macOS 10.13+ (Tauri 2 minimum); Xcode Command Line Tools
- At least one Claude Code session in `~/.claude/projects/` (for data verification during dev)

## Setup

```bash
# Install dependencies
pnpm install

# Development server (includes Rust hot-reload)
pnpm tauri dev

# Tests
pnpm test          # Frontend unit tests (vitest)
cargo test -p opsdeck  # Backend unit tests (in src-tauri/)

# Lint and format
pnpm lint
pnpm format

# Production build
pnpm build          # Frontend build only (Vite)
pnpm tauri build    # Full Tauri app bundle
```

## Project Structure

```
opsdeck/
├── README.md                 # This file
├── package.json              # Frontend dependencies
├── vite.config.ts            # Frontend build config
├── tsconfig.json             # TypeScript config
├── eslint.config.js          # Linting rules
├── src/
│   ├── App.tsx              # Root component tree
│   ├── main.tsx             # Entry point
│   ├── index.css            # Global styles (Tailwind)
│   ├── components/          # Reusable UI (theme, layout, shadcn/ui)
│   ├── features/            # Domain-specific features
│   │   ├── projects/        # Project sidebar
│   │   ├── sessions/        # Session list, filters, rows
│   │   ├── messages/        # Message view, blocks, find-bar
│   │   └── inspector/       # Context panel (token grid, tabs)
│   ├── hooks/               # Custom React hooks (queries, state)
│   ├── lib/
│   │   ├── bindings.ts      # Generated Tauri-specta type bindings
│   │   ├── ipc.ts           # Tauri command wrappers
│   │   └── i18n.ts          # Translation helper t(key)
│   └── types/               # Additional TypeScript types
├── src-tauri/               # Rust backend (Tauri app)
│   ├── Cargo.toml
│   ├── tauri.conf.json      # App config (app title, window size, CSP)
│   └── src/
│       ├── lib.rs           # Tauri app setup, specta export
│       ├── main.rs          # Entry point
│       ├── commands.rs      # Tauri command handlers
│       ├── state.rs         # Shared app state (caches)
│       ├── watcher.rs       # File watcher + events
│       ├── pricing.rs       # Token pricing table
│       └── parser/          # Session JSONL parsing logic
│           ├── raw.rs       # Raw JSONL line parsing
│           ├── normalize.rs # Message normalization
│           ├── meta.rs      # Session metadata derivation
│           └── mod.rs       # Parser module exports
└── docs/                    # Documentation
```

## Architecture Overview

**Data Flow**: `~/.claude/projects/**/*.jsonl` (read-only) → Rust parser → tauri-specta bindings → React components → UI

**Backend (Rust)**:
1. Commands: `list_projects()`, `list_sessions(projectId)`, `get_session(projectId, sessionId)`, `get_pricing()`
2. Events: `sessions-changed` fired by debounced file watcher when `.jsonl` files are added/modified
3. Parsing: JSONL line-by-line into typed structures; deduplication by message_id; cost estimation from hardcoded rates

**Frontend (React)**:
1. Query layer (TanStack Query) abstracts Tauri command calls
2. State: selection context (current project/session), live refresh context, message jump context
3. Virtualized list for 1k+ messages; find-bar state machine; lazy markdown rendering
4. Type-safe: all bindings auto-generated from Rust; no manual DTO mirrors

## Key Invariants

- **Read-only**: Frontend never writes to `~/.claude` or modifies session files
- **Path traversal protection**: Session IDs validated in Rust; no directory escapes via `/` or `..`
- **Markdown safety**: Links and images from session transcripts are neutralized (no navigation, no outbound fetches)
- **Token accuracy**: Inspector token grid totals always match session metadata (single source of truth)
- **Changes view fidelity**: Changes tab shows only tool-input-recorded content; never disk state

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm tauri dev` | Start dev server with hot-reload (Vite + Rust) |
| `pnpm test` | Run vitest (frontend unit tests) |
| `pnpm lint` | Check ESLint rules |
| `pnpm format` | Auto-format code with Prettier |
| `pnpm build` | Build Vite bundle to `dist/` |
| `pnpm tauri build` | Build macOS app bundle to `src-tauri/target/release/bundle/` |

## Deferred Features (Out of Scope for MVP)

The following are tracked for future phases but not implemented:

- **Overlay Database**: SQLite layer for aliases, tags, bookmarks, archive/trash, checkpoints, notes
- **Full-text Search**: FTS5 index on session content; saved searches
- **Job Execution**: Spawn `claude` CLI commands within sessions; live chat
- **Stats & Export**: Session aggregates, session export/redaction, share links
- **Profiles & Config Center**: Multi-workspace support, CLI config overrides

## Development Notes

- **Type Safety**: All Rust↔TypeScript bindings are auto-generated by tauri-specta during `cargo test` or `pnpm dev`. Do not edit `src/lib/bindings.ts` manually.
- **Pricing Rates**: Token pricing in `src-tauri/src/pricing.rs` are hardcoded approximations (labeled "estimated" in UI) and drift over time. Not fetched live.
- **File Watcher Debounce**: 500ms debounce on `sessions-changed` events to avoid redundant parses during rapid edits.
- **Caching**: Session metadata is mtime/size-cached in memory; cache invalidates on file modification.
- **i18n**: Add new strings to `src/lib/i18n.ts` as key → locale object. See existing `t("sidebar.projects")` calls for usage pattern.

## IDE Setup

Recommended: VS Code with extensions:
- Tauri (rust-lang.rust-analyzer)
- rust-analyzer (tauri-apps.tauri-vscode)
- ESLint (dbaeumer.vscode-eslint)
- Prettier (esbenp.prettier-vscode)

## License

© 2026. All rights reserved.
