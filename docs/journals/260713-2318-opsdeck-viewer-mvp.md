# OpsDeck Viewer MVP: Shipped in One Day

**Date**: 2026-07-13  
**Severity**: N/A (shipped)  
**Component**: OpsDeck Tauri 2 app, Rust backend, React 19 frontend  
**Status**: Resolved

## What Happened

Executed the full OpsDeck MVP plan from greenfield to shipped in a single day using the 4-phase execution template. Built a read-only Claude Code session viewer that parses and inspects local `~/.claude/projects` JSONL files. Stack: Tauri 2 for the desktop shell, Rust for the data layer (parser, metadata extraction, file watcher), React 19 + TypeScript + Tailwind v4 + shadcn/ui for the UI. Four complete phases shipped: project scaffold with Tauri/React integration, Rust data layer with type-safe Tauri-Specta codegen, session browsing UI with virtualized message rendering and live refresh, and a context inspector showing files, changes, task audit, and token usage. All gates passed (45/45 vitest, 13/13 cargo test, lint/clippy/build clean). Tree clean at 10 commits on master.

## The Brutal Truth

This was a full-sprint day that worked out almost too well. We shipped working software with zero skipped tests, which is rare enough to feel suspicious. The catch: we discovered two real issues during review that would have shipped broken if the gates hadn't caught them. The first is subtle and domain-specific (token accounting across two different codepaths); the second is a type system gap that only appears when the test runner doesn't typecheck. Both teach something important about our validation assumptions.

The relief of a clean build is real, but it masks that we got lucky catching the accounting drift in review rather than in user reports.

## Technical Details

**Architecture decisions:**
- Tauri-Specta for Rust↔TypeScript bindings: zero manual type duplication, single source of truth in Rust. The codegen runs in build and prevents the divergence that typically happens with hand-maintained mirrors.
- Inspector derivation: reuses the session query result to compute cost proportions and message summaries client-side. No second parse, no new Rust commands.
- Content security: markdown links and images from untrusted transcript content are parsed, sanitized, and rendered through controlled React components. The Changes tab data never touches disk — only the tool inputs that were recorded in the JSONL are shown.

**Failures caught in review:**

1. **Token grid undercounting**: The inspector UI summed `message.usage` over *normalized* messages (with message_id last-wins dedupe for streamed chunks). Meanwhile, the Rust metadata layer applies the same dedupe over *raw* JSONL lines — including chunks whose content normalizes away (e.g. empty thinking blocks that still carry usage). Whenever such a chunk is the last one for a message_id, the UI lost its usage. Scan of real session data showed ~26% of usage-bearing lines are empty-content thinking blocks, so the divergence is common in practice. Fix: pull `meta.tokens` and `meta.estimated_cost_usd` directly from the cached session metadata (equality by construction); use the derivation only for the cost-bar proportions within the UI.

2. **Vitest typecheck gap** (caught at build): A test file passed `vitest run` but failed `tsc`. The test mocked a `SessionMeta` object with the wrong shape — vitest doesn't enforce TypeScript strict mode by default, so the mock worked at runtime but the build gate caught it. The test was fixed inline to match the real type; this gap exists in the test infrastructure, not the code.

**Verification:**
```
vitest: 45/45 passed
cargo test: 13/13 passed
clippy: no warnings
tsc + vite build: clean
eslint: clean
```

## What We Tried

**Token accounting:** Started by reviewing the math. Added detailed comments to mark where Rust sums raw content vs the UI normalizes. Ran a scan of real session JSONL to quantify the gap (by normalized message, counting empty vs non-empty thinking chunks). Recognized that fixing at the UI level (re-normalizing in TS) was fragile; went straight to using the Rust-computed values and only deriving proportions for rendering.

**Type gap:** Discovered during tsc run. Corrected the test mock to match `SessionMeta` type exactly. Added clarifying types to the test file to surface the mismatch earlier in future changes.

## Root Cause Analysis

**Token undercounting:** We computed tokens in two different places over two different message sets. The Rust layer dedupes usage over raw JSONL lines; the UI layer deduped over normalized messages, and normalization drops empty-content chunks. The gap isn't a bug in either place — it's a contract mismatch. The fix (using Rust-computed totals) works because Rust sees every usage-bearing line, and the UI now just displays that truth.

**Vitest gap:** The test framework was too permissive. We relied on TypeScript typechecking as a gate, but the test infrastructure didn't enforce it. The test passed at runtime because JavaScript doesn't care about type shapes; it only cares about behavior. This is a known limitation of `vitest` without a strict tsconfig in the test pipeline.

## Lessons Learned

1. **Multiple sources of truth are debt.** Rust computing tokens and the UI deriving them separately isn't a minor optimization — it's a guarantee that they'll diverge. Use the authoritative source (Rust) and make the UI consume it, even if that requires restructuring the data flow.

2. **Tests that pass at runtime can fail at typecheck.** Vitest is fast and permissive, but it doesn't catch type errors. The build gate (tsc) has to run separately and is non-negotiable. Make that gate early and loud, not a post-merge check.

3. **Real data is a better validator than assumptions.** We could have assumed "normalization is negligible" and shipped undercounting. Instead, we scanned actual session files and found 26% impact. Always validate assumptions against real usage patterns before calling a feature complete.

4. **One-day sprints work only if the gates are strict.** We shipped with zero skipped tests because we didn't compromise on test passing or build cleanliness. That discipline let us move fast without technical debt creep.

## Next Steps

- The MVP is feature-complete and shipped. Interactive visual walkthrough deferred to the user.
- Monitor production usage (once deployed) for any token/cost reporting discrepancies; if found, we now have both UI and Rust layers logging independently for audit.
- Strengthen test infrastructure: enforce TypeScript in vitest (tsconfig strict mode) or add a pre-test tsc check.
- Consider a session-level audit log for token events (API call responses with token counts) to validate Rust accounting independently.

---

**Files modified:** 10 commits on master across scaffold, Rust data layer, session UI, inspector, and docs.  
**Tree state:** clean, all untracked files committed or ignored.
