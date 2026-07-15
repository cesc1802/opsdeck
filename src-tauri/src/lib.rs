mod commands;
mod db;
mod export;
mod health;
mod jobs;
mod parser;
mod pricing;
mod profiles;
mod state;
mod stats;
mod watcher;

use tauri_specta::{collect_commands, collect_events};

fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::list_projects,
            commands::list_sessions,
            commands::get_session,
            commands::get_pricing,
            commands::get_stats,
            commands::export_session,
            commands::write_export,
            jobs::commands::create_job,
            jobs::commands::list_jobs,
            jobs::commands::get_job,
            jobs::commands::attach_job,
            jobs::commands::send_user_message,
            jobs::commands::interrupt_job,
            jobs::commands::stop_job,
            jobs::commands::get_chat_config,
            jobs::commands::list_completions,
            jobs::commands::validate_dir,
            jobs::commands::validate_launch_options,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::export_profiles,
            profiles::import_profiles,
            health::run_health_checks,
            health::list_background_agents,
            health::launch_background_agent,
        ])
        .events(collect_events![watcher::SessionsChanged, jobs::JobsChanged])
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
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            // Profiles live in the app-data dir; a failed open degrades to
            // "database unavailable" command errors instead of aborting.
            use tauri::Manager;
            match app.path().app_data_dir() {
                Ok(dir) => {
                    if let Err(e) = app
                        .state::<state::AppState>()
                        .db
                        .init(&dir.join("opsdeck.db"))
                    {
                        eprintln!("[opsdeck] db init failed: {e}");
                    }
                }
                Err(e) => eprintln!("[opsdeck] no app data dir: {e}"),
            }
            watcher::spawn(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Never leave orphaned claude subprocesses behind.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<state::AppState>().jobs.kill_all();
            }
        });
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
