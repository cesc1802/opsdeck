use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use crate::jobs::JobRegistry;
use crate::parser::meta::SessionMeta;

pub struct CachedMeta {
    pub mtime: SystemTime,
    pub size: u64,
    pub meta: SessionMeta,
}

/// In-memory caches. Meta entries are keyed by file path and invalidated by
/// mtime+size mismatch; friendly project names are keyed by project id.
#[derive(Default)]
pub struct AppState {
    pub meta_cache: Mutex<HashMap<PathBuf, CachedMeta>>,
    pub project_name_cache: Mutex<HashMap<String, String>>,
    /// Live chat jobs (claude CLI subprocesses). In-memory only: jobs do not
    /// survive an app restart.
    pub jobs: JobRegistry,
}

/// Root of the Claude CLI's session store. Everything under it is read-only
/// for this app. None when no home directory can be resolved.
pub fn projects_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("projects"))
}
