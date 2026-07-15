# Promptless Chat + Slash Autocomplete: Three Phases, One Empirical Surprise

**Date**: 2026-07-15  
**Severity**: N/A (feature complete)  
**Component**: Chat UI (React), Composer input, Tauri commands, CLI integration  
**Status**: Resolved

## What Happened

Completed a three-phase feature to remove the Prompt field from New Chat, add composer-level autocomplete for slash commands and agents, and wire up filesystem-based command discovery. Phase 1 eliminated the redundant prompt input and made the composer accept text while the session status is `starting`. Phase 2 built a Rust filesystem scanner (`src-tauri/src/jobs/completions.rs`) that discovers skills and agents from `~/.claude` and project `.claude` directories, exposing them as `list_completions` Tauri command with `:` namespacing. The scanner data flows into `SessionStarted` events as `slash_commands` and `agents` fields. Phase 3 implemented pure-model autocomplete in `src/features/chat/slash-completion.ts` with token-at-caret detection, prefix filtering, and a hand-rolled ARIA listbox popup in the composer input. Timeline reducer now carries init completions from session start through the chat lifetime. All tests passing (cargo 90, vitest 114 across 16 files), tsc and eslint green.

## The Brutal Truth

We shipped the feature *before* understanding how the Claude CLI actually works with streaming JSON input. Our design assumed that the status machine would have received `init` (system message) before the composer was ready, so the autocomplete would be optional. It turns out that assumption was backwards, and we stumbled into the right implementation anyway.

The discovery happened during end-to-end testing: we sent `/skill-name` as plain stream-json text to the CLI and it triggered the skill headlessly. That shouldn't have worked if the CLI didn't know what skill to invoke. Checking the CLI's behavior with 2.1.210 revealed the surprise: with `--input-format stream-json`, the CLI emits *no system or init event* until the *first user message arrives on stdin*. This means the init data that would seed our autocompletion doesn't exist until the composer has already sent text. The feature only works because we made composer-send-during-`starting` mandatory, not defensive.

This also explains why a filesystem scan is non-negotiable: we can't wait for init to arrive before offering completion suggestions.

## Technical Details

**Architecture decisions:**

1. **Filesystem scan for first-message affordance:** `completions.rs` walks `~/.claude/skills`, `~/.claude/agents`, and `<project>/.claude/` to extract commands with `:` namespacing (e.g., `:skill/foo`, `:agent/bar`). The scan happens at session start and is exposed as a Tauri command so the UI can fetch it before any message is sent. This is *required*, not defensive.

2. **Init timing: The empirical finding.** Tested against Claude CLI 2.1.210:
   ```
   # CLI receives stream-json payload with one user message ("/skill-marker")
   # Autocomplete lists available skills from filesystem
   # CLI interprets and executes the skill
   # Skill runs headlessly and returns marker string from SKILL.md
   ```
   Proof: the marker string (unique to the skill's SKILL.md) appeared in the output *before* the session's init event arrived. This proves the CLI doesn't need init to resolve `/skill-name` — it resolves from the command string itself.

3. **Token consumption in applyCompletion.** After review: completion insertion must consume the entire token at the caret position (not leave residual mid-token text). If the caret is at `"/somes"`, inserting `/some-skill-name` must replace the entire `"/somes"` token, not append to it.

4. **ARIA listbox with IME guards.** Hand-rolled popup respects `aria-controls` (only set when the list is open). Keyboard navigation gated on `!event.nativeEvent.isComposing` to prevent input method conflicts on CJK input.

5. **Soft affordance for `/agent-name` insertion.** We inserted agent commands syntactically, but agent *execution* is model-interpreted (not CLI-level like skills). This is a UI hint, not a guarantee. Documented as soft affordance: only skill triggering is empirically proven.

**Verification:**
```
cargo test: 90/90 passed
vitest: 114/114 across 16 files
tsc: clean
eslint: clean
tester + code-reviewer subagent reports in plans/reports/
```

## What We Tried

- **Original design:** Assumed init would arrive before composer was interactive. Result: design was backwards.
- **First fix:** Made composer accept input during `starting` as a defensive measure. Turned out to be mandatory.
- **Completions discovery:** Built filesystem scan to avoid depending on init timing. Worked immediately.
- **Autocomplete UI:** Tried shadcn/ui Popover, found it too opinionated for listbox semantics. Hand-rolled ARIA listbox using CSS positioning and event handlers. Simpler and more correct.
- **Token insertion:** First pass left partial tokens in the input. Review caught it; changed to full token replacement.

## Root Cause Analysis

The root surprise: we designed for a mental model of the CLI that didn't match reality. The CLI's stream-json protocol is *stateless with respect to the caller* — it doesn't expect the caller to know about init or system messages. It resolves `/skill-name` from the command text alone, the filesystem, and the skill's SKILL.md.

Consequence: our feature *had* to rely on filesystem scanning for first-message autocompletion. There was no way around it. The design assumptions were inverted, but the implementation was correct by accident.

## Lessons Learned

1. **Empirical testing beats assumptions.** We assumed init arrival timing based on the status machine's lifecycle. One end-to-end test of actual CLI behavior contradicted that. Always test the external contract (CLI behavior) before committing to it.

2. **Filesystem as a source of truth is underrated.** Scanning the CLI's own skill/agent directories is more reliable than waiting for async events. It's also simpler and works for the very first message.

3. **Skill invocation is stateless at the CLI level.** The CLI resolves `/skill-name` from the command text and filesystem lookup alone. No init or system context required. This simplifies the UI: we can offer completion without waiting for session data.

4. **Agent commands are different.** Skills are CLI-executable. Agents are not. Inserting `/agent-name` is a UI affordance only; the model interprets it. Don't conflate the two in the mental model.

5. **IME + keyboard events need guards.** CJK input methods fire `isComposing` during multi-key sequences. Not guarding causes listbox navigation to fire while the user is mid-character. The guard is not optional.

## Next Steps

- Monitor real usage: confirm that `/skill-name` and `/agent-name` completion behaves as expected for users unfamiliar with CLI syntax.
- Consider caching the filesystem scan result and invalidating on `.claude` directory changes (watch for inotify/kqueue events).
- If agent command interpretation proves unclear to users, add a visual hint (e.g., "Agent commands are model-interpreted, not CLI-executed").
- No open bugs or type issues. Feature is production-ready.

---

**Files modified:** 3 new files (slash-completion.ts, completions.rs test module), ~6 existing files (chat UI, session reducer, Tauri commands, types).  
**Tree state:** clean, all subagent reports archived in plan directory.
