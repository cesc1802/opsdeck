use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::options::expand_path;

/// How deep to follow nested command directories (`.claude/commands/a/b.md`
/// → `a:b`). Anything deeper is almost certainly not a command tree.
const MAX_COMMAND_DEPTH: usize = 4;

/// Slash-completion names available before the CLI's `init` event arrives:
/// user- and project-scope custom commands, skills, and agents discovered on
/// disk. Plugin and built-in entries are intentionally absent — the session's
/// `init` payload supplies those once the first turn starts.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct CompletionCatalog {
    /// Slash-invocable names: custom commands plus skills.
    pub commands: Vec<String>,
    pub agents: Vec<String>,
}

/// Scan user (`~/.claude`) and project (`<cwd>/.claude`) scopes. Missing or
/// unreadable directories contribute nothing; this never fails.
pub fn scan(cwd: &str) -> CompletionCatalog {
    let mut catalog = CompletionCatalog::default();
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".claude"));
    }
    let project_root = expand_path(cwd).join(".claude");
    // cwd == home degenerates to the same root; skip the duplicate scan.
    if !roots.contains(&project_root) {
        roots.push(project_root);
    }
    for root in roots {
        scan_claude_dir(&root, &mut catalog);
    }
    for list in [&mut catalog.commands, &mut catalog.agents] {
        list.sort();
        list.dedup();
    }
    catalog
}

/// Collect names from one `.claude` directory into `catalog` (unsorted, may
/// contain duplicates across scopes; `scan` normalizes).
fn scan_claude_dir(root: &Path, catalog: &mut CompletionCatalog) {
    collect_commands(&root.join("commands"), "", 0, &mut catalog.commands);
    collect_skills(&root.join("skills"), &mut catalog.commands);
    collect_agents(&root.join("agents"), &mut catalog.agents);
}

/// `commands/review.md` → `review`; nested `commands/ck/plan.md` → `ck:plan`
/// (Claude Code's directory namespacing).
fn collect_commands(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_COMMAND_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // fs::metadata follows symlinks so linked command trees still count.
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            let nested = format!("{prefix}{name}:");
            collect_commands(&path, &nested, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            out.push(format!("{prefix}{name}"));
        }
    }
}

/// A skill is a directory containing `SKILL.md`; its name is the dir name.
fn collect_skills(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if std::fs::metadata(path.join("SKILL.md")).is_ok() {
            out.push(name.to_string());
        }
    }
}

/// An agent is a markdown file; its name is the file stem.
fn collect_agents(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
            out.push(name.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh fake `.claude` root per test so parallel tests never collide.
    fn fixture_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir()
            .join("opsdeck-completions-tests")
            .join(tag)
            .join(".claude");
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }

    fn scan_one(root: &Path) -> CompletionCatalog {
        let mut catalog = CompletionCatalog::default();
        scan_claude_dir(root, &mut catalog);
        for list in [&mut catalog.commands, &mut catalog.agents] {
            list.sort();
            list.dedup();
        }
        catalog
    }

    #[test]
    fn missing_dirs_yield_empty_catalog() {
        let catalog = scan_one(&fixture_root("missing"));
        assert!(catalog.commands.is_empty());
        assert!(catalog.agents.is_empty());
    }

    #[test]
    fn commands_skills_and_agents_are_collected() {
        let root = fixture_root("basic");
        touch(&root.join("commands/review.md"));
        touch(&root.join("commands/ck/plan.md"));
        touch(&root.join("commands/notes.txt")); // ignored: not markdown
        touch(&root.join("skills/cook/SKILL.md"));
        touch(&root.join("skills/broken/README.md")); // ignored: no SKILL.md
        touch(&root.join("agents/debugger.md"));
        touch(&root.join("agents/config.json")); // ignored: not markdown

        let catalog = scan_one(&root);
        assert_eq!(catalog.commands, vec!["ck:plan", "cook", "review"]);
        assert_eq!(catalog.agents, vec!["debugger"]);
    }

    #[test]
    fn duplicate_names_across_kinds_dedupe() {
        let root = fixture_root("dupes");
        touch(&root.join("commands/cook.md"));
        touch(&root.join("skills/cook/SKILL.md"));

        let catalog = scan_one(&root);
        assert_eq!(catalog.commands, vec!["cook"]);
    }
}
