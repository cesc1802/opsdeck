use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::new_debouncer;
use serde::{Deserialize, Serialize};
use tauri_specta::Event;

use crate::state::projects_root;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SessionsChanged {
    pub kind: String,
    pub project_id: String,
    pub session_id: Option<String>,
}

/// (project_id, session_id) for a changed path. A session file directly
/// under `<root>/<project>/` yields both ids; the project directory itself
/// (created/deleted/renamed) yields a project-level change with no session.
fn ids_for_path(root: &Path, path: &Path) -> Option<(String, Option<String>)> {
    let rel = path.strip_prefix(root).ok()?;
    let mut components = rel.components();
    let project = components.next()?.as_os_str().to_str()?.to_string();
    let Some(file) = components.next() else {
        return Some((project, None));
    };
    let file = file.as_os_str().to_str()?;
    if components.next().is_some() {
        return None;
    }
    let session = file.strip_suffix(".jsonl")?.to_string();
    Some((project, Some(session)))
}

/// Watch `~/.claude/projects` (debounced 500ms) and emit one `SessionsChanged`
/// event per changed session per batch. Watcher failure is logged, never
/// fatal: the app still works with manual refreshes.
pub fn spawn(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Some(root) = projects_root() else {
            eprintln!("[opsdeck] watcher disabled: no home directory");
            return;
        };
        if !root.is_dir() {
            eprintln!(
                "[opsdeck] watcher disabled: {} does not exist",
                root.display()
            );
            return;
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[opsdeck] watcher disabled: {e}");
                return;
            }
        };
        if let Err(e) = debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
            eprintln!("[opsdeck] watcher disabled: {e}");
            return;
        }

        for batch in rx {
            let events = match batch {
                Ok(events) => events,
                Err(e) => {
                    eprintln!("[opsdeck] watch error: {e}");
                    continue;
                }
            };
            let mut seen: HashSet<(String, Option<String>)> = HashSet::new();
            for event in events {
                if let Some(ids) = ids_for_path(&root, &event.path) {
                    seen.insert(ids);
                }
            }
            for (project_id, session_id) in seen {
                let payload = SessionsChanged {
                    kind: "changed".into(),
                    project_id,
                    session_id,
                };
                if let Err(e) = payload.emit(&app) {
                    eprintln!("[opsdeck] event emit failed: {e}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn maps_session_paths_to_ids() {
        let root = PathBuf::from("/home/x/.claude/projects");
        assert_eq!(
            ids_for_path(&root, &root.join("-Users-x-proj").join("abc.jsonl")),
            Some(("-Users-x-proj".to_string(), Some("abc".to_string())))
        );
        // Project dir itself -> project-level change (dir created/deleted)
        assert_eq!(
            ids_for_path(&root, &root.join("-Users-x-proj")),
            Some(("-Users-x-proj".to_string(), None))
        );
        // Not a session file / wrong depth / outside root
        assert_eq!(
            ids_for_path(&root, &root.join("p").join("nested").join("a.jsonl")),
            None
        );
        assert_eq!(ids_for_path(&root, Path::new("/elsewhere/a.jsonl")), None);
        assert_eq!(ids_for_path(&root, &root.join("p").join("notes.txt")), None);
    }
}
