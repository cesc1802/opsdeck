mod commands;
mod parser;
mod pricing;
mod state;
mod watcher;

use tauri_specta::{collect_commands, collect_events};

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::list_projects,
            commands::list_sessions,
            commands::get_session,
            commands::get_pricing,
        ])
        .events(collect_events![watcher::SessionsChanged])
}

#[cfg(debug_assertions)]
fn export_bindings(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(
            // Token counts are far below 2^53, so u64 -> number is safe.
            // ts-nocheck: generated glue trips noUnusedLocals; exported types
            // stay fully checked at the call sites.
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number)
                .header("/* eslint-disable */\n// @ts-nocheck"),
            "../src/lib/bindings.ts",
        )
        .expect("failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .manage(state::AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            watcher::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Keeps `src/lib/bindings.ts` regenerable via `cargo test` without
    /// launching the app.
    #[test]
    fn typescript_bindings_export() {
        super::export_bindings(&super::specta_builder());
    }
}
