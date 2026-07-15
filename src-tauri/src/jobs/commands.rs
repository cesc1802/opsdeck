use tauri::ipc::Channel;

use super::completions::{self, CompletionCatalog};
use super::options::{self, ChatConfig, FieldError, LaunchOptions};
use super::{spawn, JobEvent, JobSummary};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn create_job(
    options: LaunchOptions,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<JobSummary, String> {
    spawn::create_job(&app, &state, options)
}

#[tauri::command]
#[specta::specta]
pub async fn list_jobs(state: tauri::State<'_, AppState>) -> Result<Vec<JobSummary>, String> {
    Ok(state.jobs.summaries())
}

#[tauri::command]
#[specta::specta]
pub async fn get_job(
    job_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<JobSummary, String> {
    let job = state.jobs.get(&job_id).ok_or("unknown job")?;
    let summary = job.lock().expect("job poisoned").summary.clone();
    Ok(summary)
}

/// Replay the buffered events over the channel, then keep it registered for
/// the live tail. The client dedupes by `seq`.
#[tauri::command]
#[specta::specta]
pub async fn attach_job(
    job_id: String,
    channel: Channel<JobEvent>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    spawn::attach_job(&state, &job_id, channel)
}

#[tauri::command]
#[specta::specta]
pub async fn send_user_message(
    job_id: String,
    text: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    spawn::send_user_message(&app, &state, &job_id, &text)
}

#[tauri::command]
#[specta::specta]
pub async fn interrupt_job(
    job_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    spawn::interrupt_job(&state, &job_id)
}

#[tauri::command]
#[specta::specta]
pub async fn stop_job(
    job_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    spawn::stop_job(&app, &state, &job_id)
}

/// Static form metadata: models, efforts, permission modes, presets.
#[tauri::command]
#[specta::specta]
pub fn get_chat_config() -> ChatConfig {
    options::chat_config()
}

/// Slash-completion names scanned from `~/.claude` and `<cwd>/.claude`.
/// Available before any turn runs; the session init event later supplies the
/// authoritative superset.
#[tauri::command]
#[specta::specta]
pub fn list_completions(cwd: String) -> CompletionCatalog {
    completions::scan(&cwd)
}

/// True when the (possibly `~`-prefixed) path is an existing directory.
#[tauri::command]
#[specta::specta]
pub fn validate_dir(path: String) -> bool {
    !path.trim().is_empty() && options::expand_path(&path).is_dir()
}

/// Field-level validation for the New Chat form, without launching anything.
#[tauri::command]
#[specta::specta]
pub fn validate_launch_options(mut options: LaunchOptions) -> Vec<FieldError> {
    options::normalize_options(&mut options);
    options::validate_options(&options)
}
