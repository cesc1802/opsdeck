use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// App-owned SQLite database at `{app-data-dir}/opsdeck.db`. Never anything
/// under `~/.claude` — that tree stays read-only for this app. Profile
/// operations are tiny, so a Mutex around one connection keeps them cheap
/// without dragging in an async pool.
#[derive(Default)]
pub struct Db(Mutex<Option<Connection>>);

impl Db {
    pub fn init(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create app data dir: {e}"))?;
        }
        let conn =
            Connection::open(path).map_err(|e| format!("cannot open database: {e}"))?;
        migrate(&conn).map_err(|e| format!("cannot migrate database: {e}"))?;
        *self.0.lock().expect("db poisoned") = Some(conn);
        Ok(())
    }

    /// Run `f` against the live connection. Errors are strings so they can
    /// cross the IPC boundary unchanged.
    pub fn with<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let guard = self.0.lock().expect("db poisoned");
        let conn = guard.as_ref().ok_or("database unavailable")?;
        f(conn)
    }
}

/// Versioned schema via `PRAGMA user_version`. Options are stored as a JSON
/// column so new `LaunchOptions` fields never need DDL changes.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chat_profiles (
                name TEXT PRIMARY KEY,
                options_json TEXT NOT NULL,
                hook_builder_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            PRAGMA user_version = 1;",
        )?;
    }
    Ok(())
}

#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory sqlite");
    migrate(&conn).expect("migrate");
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_sets_user_version_and_is_idempotent() {
        let conn = open_in_memory();
        migrate(&conn).expect("second migrate is a no-op");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
        // Table exists and accepts a row.
        conn.execute(
            "INSERT INTO chat_profiles(name, options_json, created_at, updated_at)
             VALUES ('p', '{}', 0, 0)",
            [],
        )
        .unwrap();
    }
}
