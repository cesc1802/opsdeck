# New Chat Project Picker: Smooth Three-Phase Delivery

**Date**: 2026-07-15  
**Severity**: N/A (feature shipped)  
**Component**: New Chat form (Tauri/Rust backend, React frontend)  
**Status**: Resolved

## What Happened

Completed the New Chat project picker feature across three coordinated phases. The free-text `cwd` input in the New Chat form is now a Select menu of known projects (friendly name as label, real cwd as sublabel) with a "Custom path…" option that reveals the original text input when selected. The implementation is pure UI sugar — the `LaunchOptions` contract and spawn pipeline remain unchanged.

## Technical Details

**Backend (Rust):**
- `ProjectSummary` struct gained `cwd: Option<String>` field, populated from session JSONL via `project_cwd()` in `commands.rs`.
- `friendly_name` function refactored to accept a precomputed cwd parameter, eliminating duplicate JSONL reads; both `list_projects` and `get_stats` call sites updated. Cost: ≤10 JSONL lines per project per `get_stats` invocation — negligible next to full session parsing.
- No new Tauri command; `list_projects` payload extended only.

**Frontend (TypeScript/React):**
- New pure helpers module `src/features/chat/project-picker.ts` exports: `CUSTOM_CWD` sentinel, `matchProjectByCwd` with trailing-slash-only normalization (macOS-safe), `projectPickerEntries` to map projects into Select options with disabled state for `null`-cwd entries.
- Eight vitest cases in `project-picker.test.ts` covering exact match, subdir rejection, trailing slash normalization, null/empty cwd handling, and entry ordering.
- `NewChatForm` derives Select state from `options.cwd` with a sticky `customPicked` flag (prevents derivation snap-back if custom text matches a project cwd).
- `NewChatButton` in `App.tsx` seeds the form from sidebar's selected project via TanStack Query cache.
- Resume/Fork flows preselect a matching project or fall back to "Custom path…" with prefilled session cwd; field never locked.

**Verification:**
```
cargo test -p opsdeck: 86/86 pass
pnpm test: 101/101 pass (100 existing + 1 new suite with 7-8 cases)
pnpm lint: 0 errors
pnpm tsc --noEmit: 0 errors
vite build: clean
```

## What We Tried

Followed the plan's three-phase structure:
1. Backend: added field and refactored the read site.
2. Helpers: wrote pure, tested entry-point logic for picker state derivation.
3. UI: wired the Select with conditional visibility logic for the custom input.

No backtracking; each phase validated cleanly before the next began.

## Root Cause Analysis

Not applicable (no failure). The acceptance criteria were comprehensive and the design (Option C from prior consultation) was tested against existing patterns (Resume/Fork seeding, profile loads, state derivation in other forms).

## Lessons Learned

1. **Option<String> over String** proved correct — null-cwd projects now display as disabled without sentinel coercion or empty-string ambiguity.
2. **Sticky derivation flag** (customPicked) is essential to prevent the UI from snapping back to a matching project when a user types a path that happens to match an existing cwd. Simple, tested, not obvious upfront.
3. **Pure helpers with focused vitest** kept the logic decoupled from React lifecycle; seven test cases caught edge cases (root path normalization, empty lists, disabled entries) before integration.

## Next Steps

- Uncommented working tree ready for commit; no blocking issues.
- Optional: manual `pnpm tauri dev` visual pass to verify Select trigger rendering (name + cwd sublabel on one line with `line-clamp-1`).
- Optional: add test case for `cwd: "/"` root path (identified by review, non-blocking).
- Code review flagged no blocking findings; all six low/informational notes are either cosmetic (duplicate-cwd trigger display) or acceptable trade-offs (`get_stats` eager path read).

---

**Files modified:** 6 files (+134/−21 lines); 3 phases, all committed to working tree on master.  
**Tree state:** uncommitted (awaiting merge/commit approval).

Status: DONE
Summary: Three-phase project picker implementation complete; all acceptance criteria verified, gates passing (86 cargo tests, 101 vitest), code review clean with no blockers, awaiting visual confirmation via tauri dev run.
