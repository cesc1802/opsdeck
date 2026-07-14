pub mod profile_store;

use crate::jobs::options::{HookRow, LaunchOptions};
use crate::state::AppState;
use profile_store::ChatProfile;

/// Reject file paths under `~/.claude` — that tree is read-only for OpsDeck,
/// even for user-picked export destinations. Canonicalizes the target's
/// parent so `..` segments or symlinks cannot dodge the prefix check; the
/// file itself may not exist yet (export writes it).
pub(crate) fn guard_claude_tree(path: &std::path::Path) -> Result<(), String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let claude = home.join(".claude");
    let claude = claude.canonicalize().unwrap_or(claude);
    let resolved = match (path.parent(), path.file_name()) {
        (Some(parent), Some(file)) if !parent.as_os_str().is_empty() => parent
            .canonicalize()
            .map(|p| p.join(file))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    };
    if resolved.starts_with(&claude) || path.starts_with(&claude) {
        return Err("refusing to write under ~/.claude".into());
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn list_profiles(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ChatProfile>, String> {
    state.db.with(profile_store::list)
}

#[tauri::command]
#[specta::specta]
pub async fn save_profile(
    name: String,
    prev_name: Option<String>,
    options: LaunchOptions,
    hook_builder: Vec<HookRow>,
    state: tauri::State<'_, AppState>,
) -> Result<ChatProfile, String> {
    state.db.with(|conn| {
        profile_store::save(conn, &name, prev_name.as_deref(), &options, &hook_builder)
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_profile(
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.db.with(|conn| profile_store::delete(conn, &name))
}

/// Write the interchange payload to a user-picked path (dialog plugin on the
/// frontend supplies the path).
#[tauri::command]
#[specta::specta]
pub async fn export_profiles(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let target = crate::jobs::options::expand_path(&path);
    guard_claude_tree(&target)?;
    let payload = state.db.with(profile_store::export_payload)?;
    std::fs::write(&target, payload).map_err(|e| format!("cannot write {path}: {e}"))
}

/// Read and merge an interchange payload; returns how many profiles were
/// imported.
#[tauri::command]
#[specta::specta]
pub async fn import_profiles(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<u32, String> {
    let source = crate::jobs::options::expand_path(&path);
    let raw =
        std::fs::read_to_string(&source).map_err(|e| format!("cannot read {path}: {e}"))?;
    state.db.with(|conn| profile_store::import_payload(conn, &raw))
}
