# OpsDeck

A macOS-first desktop app for browsing Claude Code session records and interactive live chat with the `claude` CLI. OpsDeck reads session data from `~/.claude/projects/` and spawns new chat sessions with slash command autocomplete, displaying conversations, token usage, estimated costs, and file context.

## Features

- **Session Browsing**: Browse projects and sessions with search/filter support
- **Message Viewer**: Virtualized message display with syntax-highlighted code blocks and markdown rendering
- **Find in Session**: Cmd+F search within large conversations (no backend indexing)
- **Live Chat**: Start promptless chat sessions; send messages with job lifecycle controls (pause, resume, interrupt)
- **Slash Autocomplete**: Type `/` to see commands, skills, and agents from `~/.claude` and project directories (keyboard-navigable)
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
│   │   ├── chat/            # Live chat (composer, slash completion, job display)
│   │   ├── stats/           # Workspace stats panel
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
│       ├── commands.rs      # Tauri command handlers (list_*, get_*, start_job, etc.)
│       ├── state.rs         # Shared app state (caches)
│       ├── watcher.rs       # File watcher + events
│       ├── pricing.rs       # Token pricing table
│       ├── jobs/            # Live chat job management
│       │   ├── mod.rs       # Job lifecycle (spawn, events, state)
│       │   ├── options.rs   # LaunchOptions struct and validation
│       │   ├── completions.rs # Filesystem scanner for slash commands/skills/agents
│       │   ├── events.rs    # CLI event bridge (stream-json → JobEventPayload)
│       │   └── settings_file.rs # CLI settings file generation
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
1. Commands: `list_projects()`, `list_sessions(projectId)`, `get_session(projectId, sessionId)`, `get_pricing()`, `list_completions(cwd)`, `start_job(options)`, `send_message(jobId, text)`, `interrupt_job(jobId)`
2. Events: `sessions-changed` (file watcher), `job-events` stream (CLI output: SessionStarted, TextDelta, ToolUse, TurnResult, etc.)
3. Parsing: JSONL line-by-line into typed structures; deduplication by message_id; cost estimation from hardcoded rates
4. Completions: Scan `~/.claude` and `<cwd>/.claude` for commands, skills, and agents (used by slash autocomplete)

**Frontend (React)**:
1. Query layer (TanStack Query) abstracts Tauri command calls
2. State: selection context (current project/session), live refresh context, message jump context, chat job state
3. Chat composer with slash autocomplete (keyboard-navigable popup, two data sources: filesystem scan + CLI init event)
4. Virtualized list for 1k+ messages; find-bar state machine; lazy markdown rendering
5. Type-safe: all bindings auto-generated from Rust; no manual DTO mirrors

## Key Invariants

- **Read-only history**: Frontend never modifies existing session files; only reads `~/.claude/projects/`
- **Promptless chat**: New Chat form spawns `claude` CLI with empty initial prompt; user types first message in composer
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

## Release

Releases are built by GitHub Actions when a `v*` tag pointing to a `master` commit is pushed. The pipeline (`.github/workflows/release.yml` + per-platform `build-linux.yml` / `build-macos.yml` / `build-windows.yml`) creates a draft GitHub Release, builds Windows (`.msi`, `-setup.exe`), macOS universal (`.dmg`), and Linux (`.deb`, `.rpm`, `.AppImage`) bundles, and publishes the release only when all three builds succeed.

To cut a release:

```bash
# 1. Bump the version in package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml (keep all three in sync)
# 2. Commit to master, then tag and push:
git tag v0.1.0
git push origin v0.1.0
```

Guard rails: the pipeline stops (no release created) if the tag commit is not on `master`, or if the tag does not match the version in `src-tauri/tauri.conf.json`.

Caveats:

- **Unsigned binaries**: macOS builds are not notarized (right-click → Open, or `xattr -cr /Applications/OpsDeck.app`); Windows builds trigger SmartScreen ("More info" → "Run anyway"). Code signing is a follow-up once certificates exist.
- **Retry a failed release**: delete the draft/partial release and the tag on GitHub, then re-tag. Pre-release tags like `v0.1.0-rc1` also match `v*` but will fail the version gate unless `tauri.conf.json` matches.
- **Publish step failure**: if all builds succeed but the final publish call fails, the draft release (with all artifacts) is kept — publish it manually from the GitHub Releases UI.

## Recently Implemented

- **Live Chat**: Spawn `claude` CLI sessions with promptless launch (empty initial prompt)
- **Slash Autocomplete**: Type `/` to invoke commands, skills, and agents from user/project directories
- **Job Lifecycle**: Send messages, interrupt/resume turns, stream real-time job events

## Deferred Features (Future Phases)

The following are tracked for future development:

- **Overlay Database**: SQLite layer for aliases, tags, bookmarks, archive/trash, checkpoints, notes
- **Full-text Search**: FTS5 index on session content; saved searches
- **Stats & Export**: Session aggregates, session export/redaction, share links
- **Multi-workspace Support**: Project-level CLI config overrides, settings inheritance

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
