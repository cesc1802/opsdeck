use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::parser::meta::{is_active_mtime, SessionMeta};
use crate::parser::normalize::Message;
use crate::parser::{self, raw};
use crate::pricing::{pricing_table, PricingTable};
use crate::state::{projects_root, AppState, CachedMeta};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProjectSummary {
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub session_count: u32,
    pub active_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionDetail {
    pub meta: SessionMeta,
    pub messages: Vec<Message>,
    pub malformed_lines: u32,
}

/// Ids come from the frontend and are used as single path components under
/// the projects root. Reject anything that could escape that directory.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("invalid id: {id:?}"));
    }
    Ok(())
}

fn file_stat(path: &Path) -> Option<(SystemTime, u64)> {
    let meta = fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

/// Read the `cwd` recorded on the first parseable lines of any session file
/// in the project dir (cheaper and more reliable than decoding the dir name).
fn project_cwd(project_dir: &Path) -> Option<String> {
    let entries = fs::read_dir(project_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(file) = fs::File::open(&path) else { continue };
        for line in BufReader::new(file).lines().take(10).flatten() {
            if let Some(cwd) = raw::parse_line(&line).and_then(|l| l.cwd) {
                return Some(cwd);
            }
        }
    }
    None
}

/// Friendly project name: package.json `name` at the session cwd, falling
/// back to the cwd basename, then the raw project dir name.
fn friendly_name(state: &AppState, project_id: &str, project_dir: &Path) -> String {
    if let Some(name) = state
        .project_name_cache
        .lock()
        .expect("project name cache poisoned")
        .get(project_id)
    {
        return name.clone();
    }

    let name = project_cwd(project_dir)
        .map(|cwd| {
            let cwd_path = PathBuf::from(&cwd);
            fs::read_to_string(cwd_path.join("package.json"))
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                .and_then(|pkg| pkg.get("name")?.as_str().map(str::to_string))
                .or_else(|| {
                    cwd_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(str::to_string)
                })
                .unwrap_or(cwd)
        })
        .unwrap_or_else(|| project_id.to_string());

    state
        .project_name_cache
        .lock()
        .expect("project name cache poisoned")
        .insert(project_id.to_string(), name.clone());
    name
}

fn session_files(project_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = fs::read_dir(project_dir).map_err(|e| e.to_string())?;
    Ok(entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        })
        .collect())
}

/// Meta for one session file, served from the mtime+size cache when fresh.
/// `is_active` is always recomputed from the current mtime so a cached entry
/// cannot stay "active" forever.
fn meta_for_file(
    state: &AppState,
    table: &PricingTable,
    project_id: &str,
    path: &Path,
) -> Option<SessionMeta> {
    let session_id = path.file_stem()?.to_str()?.to_string();
    let (mtime, size) = file_stat(path)?;

    {
        let cache = state.meta_cache.lock().expect("meta cache poisoned");
        if let Some(cached) = cache.get(path) {
            if cached.mtime == mtime && cached.size == size {
                let mut meta = cached.meta.clone();
                meta.is_active = is_active_mtime(Some(mtime));
                return Some(meta);
            }
        }
    }

    let text = fs::read_to_string(path).ok()?;
    let parsed = parser::parse_session(&text);
    let meta = parser::meta::derive_meta(
        project_id,
        &session_id,
        &parsed.raw_lines,
        &parsed.messages,
        Some(mtime),
        table,
    );
    state
        .meta_cache
        .lock()
        .expect("meta cache poisoned")
        .insert(
            path.to_path_buf(),
            CachedMeta {
                mtime,
                size,
                meta: meta.clone(),
            },
        );
    Some(meta)
}

// Commands are async so cold parses run off the main thread and never freeze
// the window.
#[tauri::command]
#[specta::specta]
pub async fn list_projects(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProjectSummary>, String> {
    let Some(root) = projects_root() else {
        return Err("could not resolve home directory".into());
    };
    if !root.is_dir() {
        return Ok(vec![]);
    }

    let mut projects = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(project_id) = dir.file_name().and_then(|n| n.to_str()).map(str::to_string)
        else {
            continue;
        };
        let files = session_files(&dir).unwrap_or_default();
        if files.is_empty() {
            continue;
        }
        let active_count = files
            .iter()
            .filter(|path| is_active_mtime(file_stat(path).map(|(mtime, _)| mtime)))
            .count() as u32;
        projects.push(ProjectSummary {
            name: friendly_name(&state, &project_id, &dir),
            path: dir.to_string_lossy().into_owned(),
            session_count: files.len() as u32,
            active_count,
            project_id,
        });
    }
    projects.sort_by_key(|p| p.name.to_lowercase());
    Ok(projects)
}

#[tauri::command]
#[specta::specta]
pub async fn list_sessions(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionMeta>, String> {
    validate_id(&project_id)?;
    let Some(root) = projects_root() else {
        return Err("could not resolve home directory".into());
    };
    let dir = root.join(&project_id);
    if !dir.is_dir() {
        return Ok(vec![]);
    }

    let table = pricing_table();
    let mut sessions: Vec<SessionMeta> = session_files(&dir)?
        .iter()
        .filter_map(|path| meta_for_file(&state, &table, &project_id, path))
        .collect();
    // Newest first; ISO-8601 strings sort lexicographically.
    sessions.sort_by(|a, b| {
        let a_key = a.ended_at.as_deref().or(a.started_at.as_deref()).unwrap_or("");
        let b_key = b.ended_at.as_deref().or(b.started_at.as_deref()).unwrap_or("");
        b_key.cmp(a_key)
    });
    Ok(sessions)
}

#[tauri::command]
#[specta::specta]
pub async fn get_session(
    project_id: String,
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<SessionDetail, String> {
    validate_id(&project_id)?;
    validate_id(&session_id)?;
    let Some(root) = projects_root() else {
        return Err("could not resolve home directory".into());
    };
    let path = root.join(&project_id).join(format!("{session_id}.jsonl"));
    // Stat before reading: if the file grows during the read, the cache entry
    // carries the pre-read mtime/size and the next stat invalidates it.
    let stat = file_stat(&path);
    let text = fs::read_to_string(&path).map_err(|e| format!("cannot read session: {e}"))?;

    let table = pricing_table();
    let parsed = parser::parse_session(&text);
    let meta = parser::meta::derive_meta(
        &project_id,
        &session_id,
        &parsed.raw_lines,
        &parsed.messages,
        stat.map(|(mtime, _)| mtime),
        &table,
    );
    if let Some((mtime, size)) = stat {
        state
            .meta_cache
            .lock()
            .expect("meta cache poisoned")
            .insert(
                path,
                CachedMeta {
                    mtime,
                    size,
                    meta: meta.clone(),
                },
            );
    }
    Ok(SessionDetail {
        meta,
        messages: parsed.messages,
        malformed_lines: parsed.malformed_lines,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_pricing() -> PricingTable {
    pricing_table()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_with_traversal_or_separators_are_rejected() {
        for bad in ["", "..", "a/../b", "a/b", "a\\b", "..hidden.."] {
            assert!(validate_id(bad).is_err(), "expected rejection: {bad:?}");
        }
        assert!(validate_id("-Users-x-Documents-proj").is_ok());
        assert!(validate_id("11111111-2222-3333-4444-555555555555").is_ok());
    }
}
