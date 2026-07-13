# Feature Extraction: claude-code-manager-ui Analysis

**Date**: 2026-07-13 20:56  
**Severity**: Low (reconnaissance, no build impact)  
**Component**: Brainstorm / design research  
**Status**: Completed

## What Happened

Cloned and performed full-source analysis of [claude-code-manager-ui](https://github.com/Rylaispirit/claude-code-manager-ui), an existing FastAPI+React CLI job manager for Claude Code. Extracted 11 feature groups across backend (6 modules) and frontend (8 components), totaling ~7k LOC. Verified README claims against actual source; generated detailed feature inventory report.

## The Value

This wasn't a rebuild effort — it was surgical reconnaissance to identify design patterns proven in production that might inform opsdeck's architecture. Three insights crystallized immediately and are worth preserving.

## Key Design Patterns Worth Remembering

**1. Overlay architecture**: The codebase never touches the source `~/.claude/projects/**/*.jsonl` files. All app metadata (aliases, tags, lifecycle, bookmarks, notes, checkpoints, custom profiles) lives in a separate SQLite database. This is a masterclass in zero-risk augmentation — the CLI data stays pristine, and if the manager breaks, the audit trail survives.

**2. Backend-owned job registry with event replay**: Jobs are stored in an in-memory ring buffer (last 1000 events with sequence numbers). When a WebSocket client reconnects after tab reload or network hiccup, the backend replays the full buffer in order. Clients dedupe by seq. This eliminates the need for a message broker or persistent job queue — elegant for localhost-only use and perfectly adequate for the scale.

**3. Explicit cost labeling**: The UI distinguishes between `estimated` (from JSONL meta) and `reported` (from live CLI output). This honesty about uncertainty is valuable; we should surface this distinction whenever showing cost data.

## Observed Limitations

These don't invalidate the design; they're trade-offs baked in by the current use case:

- Per-request JSONL re-parsing: metadata endpoints re-read and parse all session files on each call (O(all sessions)), rather than serving from the FTS index. Fine for dozens of sessions; would need refactoring at scale.
- Jobs don't survive backend restart; no DB persistence. The in-memory ring buffer is a feature for UI reload resilience, not a durable journal.
- FTS search is phrase-only (queries wrapped in quotes); no boolean operators or field-specific faceting yet.

## Decision Made

User chose **inventory-only**: no rebuild into opsdeck, no partial port. The tool's architecture was the real goal, not the code. This leaves opsdeck free to design its own persistence story.

## Lessons Captured

- Separation of concerns is underrated: keeping source-of-truth immutable and mutations in their own namespace removes an entire class of sync bugs and data-loss risks.
- Simplicity at scale beats sophistication early: this codebase rejects message brokers and persistent queues, choosing in-memory ring buffer + seq replay instead. Works because scope is clear (CLI jobs, localhost, <1h sessions).
- Honesty in the UI (estimated vs. reported) builds trust. Don't hide uncertainty behind a single number.

## Next Steps

None — this was reconnaissance with explicit decision to use findings for reference only. Archive this report and integrate insights into opsdeck design conversations as new features land.

Full inventory: `plans/reports/brainstorm-260713-2056-ccm-ui-feature-extraction-report.md`
