# Tag-Gated Release Pipeline: GitHub Actions Multi-Platform Build

**Date**: 2026-07-17  
**Severity**: Medium (unverified until first tag pushed)  
**Component**: CI/CD (GitHub Actions), build automation (Tauri 2, pnpm), distribution (.deb, .rpm, .AppImage, .dmg, .msi)  
**Status**: Resolved (implementation complete, end-to-end untested)

## What Happened

Built and deployed a tag-gated GitHub Actions release pipeline for OpsDeck that orchestrates cross-platform builds (Windows, macOS, Linux) triggered by git tags matching `v*`. Architecture: one orchestrator workflow (`.github/workflows/release.yml`) that listens only to tag pushes, creates a draft release via GitHub API, and delegates builds to three reusable `workflow_call` workflows — build-linux.yml (Ubuntu 22.04 with webkit2gtk-4.1 apt deps → .deb/.rpm/.AppImage), build-macos.yml (universal Apple Silicon + Intel → .dmg), build-windows.yml (.msi + NSIS setup.exe). Orchestrator passes release_id to each build, which upload artifacts directly without creating concurrent releases (avoids race condition of 3 simultaneous release creations). Publish happens only after all three succeed. Added `"packageManager": "pnpm@10.23.0"` to package.json (required by pnpm/action-setup@v4). All code is in master, verified via actionlint (clean on all 4 files), local `pnpm tauri build` smoke test (OpsDeck.app + .dmg produced), and code-reviewer feedback (3 minor hardening issues applied: cleanup job guard, delete error handling, missing concurrency group).

## The Brutal Truth

Release automation feels like it works until it doesn't, and the first tag push will be the real test. The entire pipeline is syntactically valid and logically sound — but end-to-end verification requires actually pushing a tag, watching three build runners spin up in parallel, and seeing artifacts land in the release. We can't do that without a real `v0.1.0` tag, and we can't tag until the user is ready to actually release. This creates a trust gap: we built the mechanism, but we haven't proven it works. The honest fear: a subtle GitHub API call failure, a race condition in artifact upload, or a path issue in one of the runners will only surface after merge.

The frustrating part is that version sync lives in three files (package.json, tauri.conf.json, Cargo.toml) with manual synchronization only. There's no automation or validation to prevent the builds from succeeding but creating binaries with mismatched versions. That's a gap we know about but chose to defer.

## Technical Details

**Key architectural decisions:**

1. **Orchestrator as release-manager, not builder:** Only `.github/workflows/release.yml` has a `push: tags:` trigger. It creates the draft release in one place, extracts the release_id, and passes it to all three builders. This eliminates the race condition of three concurrent workflows each trying to create a v0.1.0 release. If one build fails, the release stays draft and we retry without duplicates.

2. **Tag validation gate:** Before any build runs, the orchestrator checks: (a) tag commit is an ancestor of origin/master (via `git merge-base --is-ancestor`), and (b) tag name equals the version in tauri.conf.json (prevents v0.1.0 tag pointing to code with version 0.2.0 in config). Prevents mismatched version releases.

3. **Dropped planned `tag` workflow_call input:** Initially planned to pass the tag name to each build workflow, but discovered reusable workflows inherit the caller's git ref automatically. No extra parameter needed. This reduced coupling and simplified the contract.

4. **No code signing yet:** Builds produce unsigned binaries. macOS will show "unverified developer" warnings on first run. Windows .msi and setup.exe are unsigned. Documented caveats in README Release section. Signing certificates are not yet in place; deferred to a future hardening phase.

**Verification snapshot:**
```
actionlint: all 4 workflow files pass linting (0 errors)
pnpm tauri build (local smoke test): OpsDeck.app built, .dmg created successfully
code-reviewer audit: 3 minor findings, all applied (cleanup guard, error handling, concurrency group)
No undefined GitHub Actions: all actions resolved to real versions
```

## What We Tried

- **Orchestrator pattern over distributed builds:** Considered having each platform workflow listen independently to tags (simpler routing). Rejected because three simultaneous release creates would race. Chose single orchestrator.
- **Version validation:** Debated whether to extract version programmatically from tauri.conf.json or require exact tag match. Chose exact match to fail fast if manual sync breaks.
- **Artifact upload: gh release upload vs. tauri-action:** tauri-action@v0 has upload-only mode. Reused it to avoid shell script fragility. GitHub CLI would be alternative; felt more stable to stay within tauri tooling.

## Root Cause Analysis

Why did we build this now? OpsDeck hit a milestone where the distributed app works locally and should be installable by users. GitHub Actions release automation is the standard way to publish Tauri apps. The decision to tag-gate (rather than e.g., publish-on-every-commit) follows the principle that releases should be deliberate and version-controlled. The three-platform split is forced by Tauri's architecture: platform-specific binaries, platform-specific toolchains. The orchestrator pattern emerged when we realized concurrent release creates would create duplicate releases.

## Lessons Learned

1. **Cross-platform CI/CD multiplies complexity.** One workflow is simple; three platforms mean three different dependency paths, three different artifact formats, three opportunities for one to fail while the others succeed. The orchestrator pattern helps, but testing is essential.

2. **Manual version sync is a landmine.** Three files, three formats, one truth. Either automate it or accept the risk. We chose to accept it for now, but this will bite someone when Cargo.toml is bumped and someone forgets package.json.

3. **API-driven release creation is safer than shell scripts.** Using GitHub CLI (or GitHub Actions API) to create the release atomically is better than shell logic. One API call, one result, no race.

4. **Unsigned binaries are a user experience problem, not a security one (yet).** Users will see warnings on first install. We document this, but automation can't fix user trust. Signing is a prerequisite for a smooth user experience.

5. **End-to-end is not "done" until you actually push the tag.** This pipeline is 95% there. The remaining 5% is the part that only works in production. Humble.

## Next Steps

- User will tag a release candidate (e.g., `v0.1.0-rc1`) after merge. Monitor the workflow run to confirm all three builds succeed.
- If any build fails in the real tag push, debug and iterate. Local smoke tests catch syntax errors, but runner-specific issues (missing apt packages, path differences) only show up in CI.
- Version sync: consider a pre-commit hook or CI check that validates tauri.conf.json ↔ package.json ↔ Cargo.toml match (deferred, not blocking).
- Code signing: plan a follow-up phase to add certificates for macOS and Windows once we have the Apple Developer Program membership and Windows code-signing cert.

---

**Files modified:** 4 workflow files (1 orchestrator, 3 reusable), package.json (pnpm version added).  
**Tree state:** Merged to master; ready for tag-based release.  
**Plan reference:** plans/260717-1506-tauri-release-cicd/ (all 3 phases completed).

---

Status: DONE_WITH_CONCERNS  
Summary: Tag-gated release pipeline is syntactically validated and architecturally sound, but end-to-end verification requires pushing a real tag post-merge. Version sync across three files remains manual and unvalidated.  
Concerns/Blockers: (1) Untested in production (no real tag pushed yet); (2) manual version sync across package.json/tauri.conf.json/Cargo.toml; (3) unsigned binaries will show OS warnings on install.
