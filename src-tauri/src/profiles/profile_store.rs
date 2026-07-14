use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::jobs::now_ms;
use crate::jobs::options::{parse_hook_rows, HookRow, LaunchOptions};

/// Interchange payload version for import/export files. The SQLite table is
/// the store; this JSON shape exists only so profiles can move between
/// machines.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ChatProfile {
    pub name: String,
    pub options: LaunchOptions,
    /// Hook builder rows kept alongside the compiled `options.hooks_json` so
    /// editing never loses row structure.
    pub hook_builder: Vec<HookRow>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// Export/import file shape: `{schema_version: 1, profiles: {name: options}}`.
/// BTreeMap keeps profile order deterministic so export → import → export is
/// byte-stable.
#[derive(Debug, Serialize, Deserialize)]
struct ProfilePayload {
    schema_version: u32,
    profiles: BTreeMap<String, LaunchOptions>,
}

fn sql_err(e: rusqlite::Error) -> String {
    format!("profile store error: {e}")
}

fn row_to_profile(row: &rusqlite::Row<'_>) -> Result<ChatProfile, String> {
    let name: String = row.get(0).map_err(sql_err)?;
    let options_json: String = row.get(1).map_err(sql_err)?;
    let hook_builder_json: String = row.get(2).map_err(sql_err)?;
    let created_at: i64 = row.get(3).map_err(sql_err)?;
    let updated_at: i64 = row.get(4).map_err(sql_err)?;
    let options: LaunchOptions = serde_json::from_str(&options_json)
        .map_err(|e| format!("profile {name:?} has corrupt options: {e}"))?;
    let hook_builder: Vec<HookRow> = serde_json::from_str(&hook_builder_json)
        .map_err(|e| format!("profile {name:?} has corrupt hook rows: {e}"))?;
    Ok(ChatProfile {
        name,
        options,
        hook_builder,
        created_at_ms: created_at.max(0) as u64,
        updated_at_ms: updated_at.max(0) as u64,
    })
}

const SELECT_COLUMNS: &str =
    "name, options_json, hook_builder_json, created_at, updated_at";

pub fn list(conn: &Connection) -> Result<Vec<ChatProfile>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM chat_profiles ORDER BY name"
        ))
        .map_err(sql_err)?;
    let mut rows = stmt.query([]).map_err(sql_err)?;
    let mut profiles = Vec::new();
    while let Some(row) = rows.next().map_err(sql_err)? {
        profiles.push(row_to_profile(row)?);
    }
    Ok(profiles)
}

pub fn get(conn: &Connection, name: &str) -> Result<Option<ChatProfile>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM chat_profiles WHERE name = ?1"
        ))
        .map_err(sql_err)?;
    let mut rows = stmt.query(params![name]).map_err(sql_err)?;
    match rows.next().map_err(sql_err)? {
        Some(row) => Ok(Some(row_to_profile(row)?)),
        None => Ok(None),
    }
}

/// Save a profile; `prev_name` carries rename semantics (save under the new
/// name, then drop the old row — mirrors the reference app's PUT). Refuses to
/// clobber an existing profile unless the save is an in-place update
/// (`prev_name` == `name`); imports that intentionally merge use `upsert`.
pub fn save(
    conn: &Connection,
    name: &str,
    prev_name: Option<&str>,
    options: &LaunchOptions,
    hook_builder: &[HookRow],
) -> Result<ChatProfile, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("profile name is required".into());
    }
    let updating_in_place = prev_name.map(str::trim) == Some(name);
    if !updating_in_place && get(conn, name)?.is_some() {
        return Err(format!(
            "profile {name:?} already exists — pick another name or delete it first"
        ));
    }
    let saved = upsert(conn, name, options, hook_builder)?;
    if let Some(prev) = prev_name {
        let prev = prev.trim();
        if !prev.is_empty() && prev != name {
            delete(conn, prev)?;
        }
    }
    Ok(saved)
}

/// Write a profile row unconditionally (insert or overwrite by name).
fn upsert(
    conn: &Connection,
    name: &str,
    options: &LaunchOptions,
    hook_builder: &[HookRow],
) -> Result<ChatProfile, String> {
    let options_json =
        serde_json::to_string(options).map_err(|e| format!("cannot encode options: {e}"))?;
    let hook_builder_json = serde_json::to_string(hook_builder)
        .map_err(|e| format!("cannot encode hook rows: {e}"))?;
    let now = now_ms() as i64;
    conn.execute(
        "INSERT INTO chat_profiles(name, options_json, hook_builder_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(name) DO UPDATE SET
           options_json = excluded.options_json,
           hook_builder_json = excluded.hook_builder_json,
           updated_at = excluded.updated_at",
        params![name, options_json, hook_builder_json, now],
    )
    .map_err(sql_err)?;
    get(conn, name)?.ok_or_else(|| "profile vanished after save".into())
}

pub fn delete(conn: &Connection, name: &str) -> Result<(), String> {
    conn.execute("DELETE FROM chat_profiles WHERE name = ?1", params![name])
        .map_err(sql_err)?;
    Ok(())
}

/// Serialize every profile into the interchange payload. Hook builder rows
/// travel inside `options.hooks_json`, so nothing is lost in the flat shape.
pub fn export_payload(conn: &Connection) -> Result<String, String> {
    let profiles = list(conn)?;
    let payload = ProfilePayload {
        schema_version: SCHEMA_VERSION,
        profiles: profiles
            .into_iter()
            .map(|p| (p.name, p.options))
            .collect(),
    };
    serde_json::to_string_pretty(&payload).map_err(|e| format!("cannot encode payload: {e}"))
}

/// Parse and upsert an interchange payload. Returns the number of profiles
/// written. Rejects unknown schema versions and profiles with broken hook
/// rows rather than importing half a file.
pub fn import_payload(conn: &Connection, raw: &str) -> Result<u32, String> {
    let payload: ProfilePayload =
        serde_json::from_str(raw).map_err(|e| format!("invalid profile file: {e}"))?;
    if payload.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported schema_version {} (expected {SCHEMA_VERSION})",
            payload.schema_version
        ));
    }
    let mut prepared: Vec<(String, LaunchOptions, Vec<HookRow>)> = Vec::new();
    for (name, options) in payload.profiles {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("profile file contains an empty profile name".into());
        }
        let hook_builder = match options.hooks_json.as_deref() {
            Some(raw) if !raw.trim().is_empty() => parse_hook_rows(raw)
                .map_err(|e| format!("profile {name:?}: hooks_json {e}"))?,
            _ => Vec::new(),
        };
        prepared.push((name, options, hook_builder));
    }
    let count = prepared.len() as u32;
    // Imports merge: same-named profiles are overwritten by design. The
    // transaction keeps a mid-loop SQL failure from leaving half the file in.
    let tx = conn.unchecked_transaction().map_err(sql_err)?;
    for (name, options, hook_builder) in &prepared {
        upsert(&tx, name, options, hook_builder)?;
    }
    tx.commit().map_err(sql_err)?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn options(cwd: &str) -> LaunchOptions {
        LaunchOptions {
            cwd: cwd.into(),
            prompt: "hello".into(),
            ..Default::default()
        }
    }

    fn hook_row() -> HookRow {
        HookRow {
            event: "PreToolUse".into(),
            matcher: Some("Bash".into()),
            command: "echo hi".into(),
            timeout: 30.0,
            enabled: true,
        }
    }

    #[test]
    fn crud_round_trip() {
        let conn = open_in_memory();
        let saved = save(&conn, "alpha", None, &options("/tmp"), &[hook_row()]).unwrap();
        assert_eq!(saved.name, "alpha");
        assert_eq!(saved.hook_builder.len(), 1);
        assert!(saved.created_at_ms > 0);

        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].options.cwd, "/tmp");

        save(&conn, "alpha", Some("alpha"), &options("/opt"), &[]).unwrap();
        let updated = get(&conn, "alpha").unwrap().unwrap();
        assert_eq!(updated.options.cwd, "/opt");
        assert_eq!(updated.created_at_ms, saved.created_at_ms);
        assert!(updated.hook_builder.is_empty());

        delete(&conn, "alpha").unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn rename_drops_the_old_row() {
        let conn = open_in_memory();
        save(&conn, "old", None, &options("/tmp"), &[]).unwrap();
        let renamed = save(&conn, "new", Some("old"), &options("/tmp"), &[]).unwrap();
        assert_eq!(renamed.name, "new");
        assert!(get(&conn, "old").unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn save_refuses_to_clobber_an_existing_profile() {
        let conn = open_in_memory();
        save(&conn, "dev", None, &options("/tmp"), &[]).unwrap();
        save(&conn, "prod", None, &options("/opt"), &[]).unwrap();

        // Creating a new profile under a taken name is rejected.
        let err = save(&conn, "prod", None, &options("/elsewhere"), &[]).unwrap_err();
        assert!(err.contains("already exists"));

        // Renaming onto a taken name is rejected and both rows survive.
        let err = save(&conn, "prod", Some("dev"), &options("/tmp"), &[]).unwrap_err();
        assert!(err.contains("already exists"));
        assert_eq!(get(&conn, "prod").unwrap().unwrap().options.cwd, "/opt");
        assert_eq!(get(&conn, "dev").unwrap().unwrap().options.cwd, "/tmp");
    }

    #[test]
    fn import_overwrites_same_named_profiles() {
        let conn = open_in_memory();
        save(&conn, "dev", None, &options("/old"), &[]).unwrap();
        let raw = r#"{"schema_version":1,"profiles":{"dev":{"cwd":"/new","prompt":"p"}}}"#;
        assert_eq!(import_payload(&conn, raw).unwrap(), 1);
        assert_eq!(get(&conn, "dev").unwrap().unwrap().options.cwd, "/new");
    }

    #[test]
    fn blank_names_are_rejected() {
        let conn = open_in_memory();
        assert!(save(&conn, "  ", None, &options("/tmp"), &[]).is_err());
    }

    #[test]
    fn import_rejects_wrong_schema_version() {
        let conn = open_in_memory();
        let err = import_payload(&conn, r#"{"schema_version":2,"profiles":{}}"#)
            .unwrap_err();
        assert!(err.contains("schema_version"));
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn import_rejects_broken_hook_rows_without_partial_writes() {
        let conn = open_in_memory();
        let raw = r#"{"schema_version":1,"profiles":{"a":{"cwd":"/tmp","prompt":"p"},"b":{"cwd":"/tmp","prompt":"p","hooks_json":"not json"}}}"#;
        assert!(import_payload(&conn, raw).is_err());
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn export_import_round_trip_is_byte_stable() {
        let conn = open_in_memory();
        let mut opts = options("/tmp");
        opts.model = Some("opus".into());
        opts.hooks_json = Some(
            serde_json::to_string(&vec![hook_row()]).unwrap(),
        );
        save(&conn, "beta", None, &opts, &[hook_row()]).unwrap();
        save(&conn, "alpha", None, &options("/opt"), &[]).unwrap();

        let exported = export_payload(&conn).unwrap();

        let other = open_in_memory();
        let count = import_payload(&other, &exported).unwrap();
        assert_eq!(count, 2);
        // Hook builder rows are rebuilt from options.hooks_json on import.
        let beta = get(&other, "beta").unwrap().unwrap();
        assert_eq!(beta.hook_builder.len(), 1);
        assert_eq!(beta.hook_builder[0].command, "echo hi");

        let re_exported = export_payload(&other).unwrap();
        assert_eq!(exported, re_exported);
    }
}
