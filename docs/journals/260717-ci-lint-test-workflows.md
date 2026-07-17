# Automated Lint and Test Workflows: First Format/Linting Run Reveals Entanglement

**Date**: 2026-07-17  
**Severity**: Medium (style debt now blocking, but test coverage clean)  
**Component**: CI/CD (GitHub Actions), linting (eslint, rustfmt, clippy), testing (vitest, cargo test)  
**Status**: Resolved (workflows deployed, but master lint state depends on feature branch merge)

## What Happened

Built two separate GitHub Actions workflows — `.github/workflows/lint.yml` and `.github/workflows/test.yml` — that automatically validate code style and run the full test suite on every push to master and PR targeting master. `lint.yml` runs `pnpm lint` (eslint), then `cargo fmt --check` (fail-fast), then `clippy --all-targets -D warnings`. `test.yml` runs frontend tests via `vitest` and backend tests via `cargo test`. Both use minimal permissions (`contents: read`), cancel in-progress runs only on non-master refs (to preserve per-commit CI history), and both pre-create the `dist/` directory required by tauri-build during clippy/test compilation. Added webkit2gtk-4.1 apt dependencies for Linux runners. Commit 0a3bb5f established both workflows (actionlint-verified clean); commit a3b7632 applied rustfmt + fixed one clippy error (`unnecessary_sort_by` in src-tauri/src/jobs/mod.rs, refactored to `sort_by_key(Reverse)` — behavior-preserving, stable sort).

## The Brutal Truth

We never ran rustfmt or clippy on this repo before. The first time we ran it — not locally during feature work, but as a CI gate — it screamed: HEAD was not fmt-clean, clippy found an issue, and our code failed the checks it now runs on every commit. That's an uncomfortable moment, but the worse pain is this: five Rust files (commands.rs, jobs/options.rs, jobs/settings_file.rs, lib.rs, state.rs) have their formatting fixes tangled together with the in-flight remove-configuration feature branch. We can't commit just the CI + format fixes without the feature code, and we can't ship just the CI without keeping master's lint state red until the feature merges. This is the frustrating part — automation designed to prevent style drift created a coupling problem because we didn't run the linter *before* diverging the feature branch.

## Technical Details

**Workflow structure:**

```yaml
# .github/workflows/lint.yml
jobs:
  eslint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4 with: version: 10.23.0
      - run: pnpm lint

  rust-lint:
    runs-on: ubuntu-latest
    steps:
      - run: cargo fmt --check  # fail-fast
      - run: apt-get install -y libwebkit2gtk-4.1-dev
      - run: cargo clippy --all-targets -D warnings

# .github/workflows/test.yml
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test

  backend:
    runs-on: ubuntu-latest
    steps:
      - run: mkdir -p dist
      - run: apt-get install -y libwebkit2gtk-4.1-dev
      - run: cargo test
```

**Key constraints:**
- `permissions: contents: read` (minimal, no write access)
- `concurrency: group: ${{ github.ref }}` with `cancel-in-progress: true` only on non-master refs (preserves per-commit CI history on master, where cancellation would hide which commit introduced a regression)
- `mkdir -p dist` before cargo jobs: tauri-build requires the gitignored frontendDist directory to exist at compile time even though it's empty

**Verification snapshot:**
```
pnpm lint: ✓ (eslint 0 errors)
vitest: ✓ (104/104 passing)
cargo test: ✓ (74/74 passing)
cargo clippy -D warnings: ✓ (clean after sort_by_key fix)
actionlint: ✓ (both workflows valid)
```

## What We Tried

- **Separate workflows vs. monolithic:** Chose separate files (lint.yml, test.yml) to isolate failures and make actionability clear. A single failing test or linting error is now easier to find and triage.
- **cargo fmt --check ordering:** Code-reviewer flagged that `cargo fmt --check` was running *after* apt deps were installed. Reordered to fail-fast before any apt operations.
- **Concurrency on master:** Code-reviewer noted that cancelling in-progress runs on master would hide which commit broke the build. Applied: concurrency group only cancels on non-master refs.

## Root Cause Analysis

Why now? OpsDeck has grown beyond a single developer experimenting locally. Automated style enforcement prevents drift and reduces review friction. The codebase never had rustfmt or clippy enforced before (these are explicit opt-in checks for Rust, unlike `npm run lint` which is conventional). First time any linter runs on legacy code, it finds debt.

The entanglement happened because we applied style fixes and feature work on the same branch. The remove-configuration refactor touched those five files, and during that work, we (correctly) ran rustfmt. But now we can't land the CI workflows without also landing their style fixes, which are mixed with the feature. This is not a bug in the CI; it's a workflow timing mistake on our side.

## Lessons Learned

1. **Run rustfmt and clippy before branching.** Format the entire repo once, commit it to master, then feature branches start clean. We skipped this and paid the price: now our format fixes are forever entangled with a feature commit.

2. **Separate concerns matter for CI debuggability.** Two workflows let us see "lint failed" vs. "tests failed" with one look. Monolithic workflows hide the signal.

3. **Tauri builds require compiled dependencies even for checks.** Even `cargo clippy` needs webkit2gtk-4.1 on Linux (because it compiles the tauri crate as a dependency). Document this for anyone adding future CI jobs.

4. **Concurrency strategy affects debugging.** Cancelling in-progress runs on master hides regressions. We preserve history per commit, which costs time but gains visibility.

5. **First-pass linter runs reveal depth of debt.** One clippy error found, one fmt pass needed. Not catastrophic, but it's a signal that code hasn't been validated against the project's chosen standards before now.

## Next Steps

- Remove-configuration feature branch will merge with its entangled format fixes. Once merged, master will be lint-clean (all 5 files reformatted, sort_by_key fix included).
- Going forward: run `pnpm lint && cargo fmt && cargo clippy` locally before opening a PR (add to CONTRIBUTING.md or pre-commit hooks if appropriate).
- If style debt appears in future feature branches: commit a separate "style: apply rustfmt/clippy" commit on the feature branch itself (do not wait until merge).

---

**Files modified:** 2 workflow files (lint.yml, test.yml) + 1 code fix (src-tauri/src/jobs/mod.rs) + 5 uncommitted fmt changes pending with remove-configuration feature.  
**Tree state:** Workflows merged to master; master lint state remains red until remove-configuration feature merges (expected, documented).  
**Plan reference:** plans/260717-1506-tauri-release-cicd/ (ci/test phase).

---

Status: DONE_WITH_CONCERNS  
Summary: Lint and test workflows are deployed and passing all local test suites (104 frontend, 74 backend tests), but master's linting state is temporarily red due to five uncommitted format fixes entangled with the in-flight remove-configuration feature branch.  
Concerns/Blockers: (1) master rust-lint blocked until feature branch merges; (2) first-time linter run found tech debt (HEAD not fmt-clean); (3) tauri-build dependency on webkit2gtk for CI is not obvious and could trip up future maintainers.
