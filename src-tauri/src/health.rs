use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::jobs::options::{validate_options, LaunchOptions};
use crate::jobs::spawn::kill_pid;
use crate::profiles::profile_store;
use crate::state::AppState;

const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const BG_LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);
const DETAIL_CLAMP: usize = 8_000;

/// The fixed CLI probes. Every command is an argv vector — no shell anywhere.
pub const CLI_CHECKS: [(&str, &[&str]); 5] = [
    ("claude --version", &["--version"]),
    ("claude auth status", &["auth", "status"]),
    ("claude doctor", &["doctor"]),
    ("claude mcp list", &["mcp", "list"]),
    ("claude plugin list", &["plugin", "list"]),
];

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct HealthCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
    pub duration_ms: u64,
}

/// Test override so cargo tests can point checks at a fixture script instead
/// of a real `claude` install.
pub fn claude_bin() -> String {
    std::env::var("OPSDECK_CLAUDE_BIN").unwrap_or_else(|_| "claude".into())
}

fn clamp(mut text: String) -> String {
    if text.chars().count() > DETAIL_CLAMP {
        text = text.chars().take(DETAIL_CLAMP).collect();
        text.push_str("\n… (truncated)");
    }
    text
}

/// Run one CLI command with a hard timeout. Never returns Err upward — every
/// failure mode (missing binary, non-zero exit, hang) becomes `ok: false`
/// with a human-readable detail.
pub fn run_cli_check(name: &str, args: &[&str], timeout: Duration) -> HealthCheck {
    let started = Instant::now();
    let spawned = Command::new(claude_bin())
        .args(args)
        // Non-tty stdio: interactive commands (`claude doctor`) must not wait
        // for input; a hang is caught by the timeout below.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let child = match spawned {
        Ok(child) => child,
        Err(e) => {
            return HealthCheck {
                name: name.into(),
                ok: false,
                detail: format!("failed to spawn: {e}"),
                duration_ms: started.elapsed().as_millis() as u64,
            }
        }
    };
    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    let (ok, detail) = match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.trim().is_empty() {
                if !text.trim().is_empty() {
                    text.push('\n');
                }
                text.push_str(stderr.trim_end());
            }
            (output.status.success(), text.trim().to_string())
        }
        Ok(Err(e)) => (false, format!("failed to read output: {e}")),
        Err(_) => {
            kill_pid(pid, true);
            (false, format!("timed out after {}s", timeout.as_secs()))
        }
    };

    HealthCheck {
        name: name.into(),
        ok,
        detail: clamp(detail),
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

/// All checks run concurrently: total wall time ≈ the slowest single check.
fn run_checks(
    live_jobs: usize,
    total_jobs: usize,
    profiles: Vec<(String, LaunchOptions)>,
) -> Vec<HealthCheck> {
    let handles: Vec<_> = CLI_CHECKS
        .iter()
        .map(|(name, args)| {
            std::thread::spawn(move || run_cli_check(name, args, CHECK_TIMEOUT))
        })
        .collect();

    let mut checks: Vec<HealthCheck> = handles
        .into_iter()
        .map(|handle| handle.join().expect("health check thread panicked"))
        .collect();

    checks.push(HealthCheck {
        name: "running jobs".into(),
        ok: true,
        detail: format!("{live_jobs} live / {total_jobs} total this app run"),
        duration_ms: 0,
    });

    for (name, options) in profiles {
        let started = Instant::now();
        let errors = validate_options(&options);
        let detail = if errors.is_empty() {
            "options valid".to_string()
        } else {
            errors
                .iter()
                .map(|e| format!("{}: {}", e.field, e.message))
                .collect::<Vec<_>>()
                .join("\n")
        };
        checks.push(HealthCheck {
            name: format!("profile: {name}"),
            ok: detail == "options valid",
            detail,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }
    checks
}

#[tauri::command]
#[specta::specta]
pub async fn run_health_checks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<HealthCheck>, String> {
    let summaries = state.jobs.summaries();
    let live = summaries
        .iter()
        .filter(|s| !s.status.is_terminal())
        .count();
    let total = summaries.len();
    // A missing database is itself a health finding, not a hard error.
    let (profiles, db_error) = match state.db.with(profile_store::list) {
        Ok(profiles) => (
            profiles
                .into_iter()
                .map(|p| (p.name, p.options))
                .collect(),
            None,
        ),
        Err(e) => (Vec::new(), Some(e)),
    };
    let mut checks =
        tauri::async_runtime::spawn_blocking(move || run_checks(live, total, profiles))
            .await
            .map_err(|e| format!("health run failed: {e}"))?;
    if let Some(e) = db_error {
        checks.push(HealthCheck {
            name: "profile store".into(),
            ok: false,
            detail: e,
            duration_ms: 0,
        });
    }
    Ok(checks)
}

/// Raw JSON from `claude agents --json --all`; the UI parses and renders each
/// agent in a mono disclosure.
#[tauri::command]
#[specta::specta]
pub async fn list_background_agents() -> Result<String, String> {
    let check = tauri::async_runtime::spawn_blocking(|| {
        run_cli_check(
            "claude agents",
            &["agents", "--json", "--all"],
            CHECK_TIMEOUT,
        )
    })
    .await
    .map_err(|e| format!("agents list failed: {e}"))?;
    if check.ok {
        Ok(check.detail)
    } else {
        Err(check.detail)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn launch_background_agent(prompt: String) -> Result<String, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt is required".into());
    }
    let check = tauri::async_runtime::spawn_blocking(move || {
        run_cli_check("claude --bg", &["--bg", &prompt], BG_LAUNCH_TIMEOUT)
    })
    .await
    .map_err(|e| format!("agent launch failed: {e}"))?;
    if check.ok {
        Ok(check.detail)
    } else {
        Err(check.detail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    /// Install a fixture script as the fake claude binary for one test.
    fn fixture(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("opsdeck-health-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        writeln!(file, "#!/bin/sh\n{body}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    /// Serialize env-var mutation across tests in this module.
    fn with_claude_bin<T>(path: &PathBuf, f: impl FnOnce() -> T) -> T {
        static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("OPSDECK_CLAUDE_BIN", path);
        let result = f();
        std::env::remove_var("OPSDECK_CLAUDE_BIN");
        result
    }

    #[test]
    fn cli_checks_cover_the_expected_arg_vectors() {
        let vectors: Vec<&[&str]> = CLI_CHECKS.iter().map(|(_, args)| *args).collect();
        assert!(vectors.contains(&["--version"].as_slice()));
        assert!(vectors.contains(&["auth", "status"].as_slice()));
        assert!(vectors.contains(&["doctor"].as_slice()));
        assert!(vectors.contains(&["mcp", "list"].as_slice()));
        assert!(vectors.contains(&["plugin", "list"].as_slice()));
        // No vector smuggles a shell in.
        assert!(vectors.iter().flat_map(|v| v.iter()).all(|a| !a.contains("sh -c")));
    }

    #[test]
    #[cfg(unix)]
    fn check_captures_output_and_exit_status() {
        let bin = fixture("ok.sh", "echo hello; echo warn >&2; exit 0");
        let check = with_claude_bin(&bin, || {
            run_cli_check("ok", &["--version"], Duration::from_secs(5))
        });
        assert!(check.ok);
        assert!(check.detail.contains("hello"));
        assert!(check.detail.contains("warn"));

        let bin = fixture("bad.sh", "echo broken >&2; exit 3");
        let check = with_claude_bin(&bin, || {
            run_cli_check("bad", &["doctor"], Duration::from_secs(5))
        });
        assert!(!check.ok);
        assert!(check.detail.contains("broken"));
    }

    #[test]
    #[cfg(unix)]
    fn hanging_check_times_out() {
        let bin = fixture("hang.sh", "sleep 30");
        let check = with_claude_bin(&bin, || {
            run_cli_check("hang", &["doctor"], Duration::from_millis(200))
        });
        assert!(!check.ok);
        assert!(check.detail.contains("timed out"));
        assert!(check.duration_ms < 5_000);
    }

    #[test]
    fn missing_binary_is_a_failed_check_not_a_panic() {
        let bin = PathBuf::from("/definitely/not/claude");
        let check = with_claude_bin(&bin, || {
            run_cli_check("gone", &["--version"], Duration::from_secs(1))
        });
        assert!(!check.ok);
        assert!(check.detail.contains("failed to spawn"));
    }

    #[test]
    #[cfg(unix)]
    fn run_checks_is_parallel_and_appends_jobs_and_profiles() {
        // Each CLI probe sleeps 300ms; serial would be ≥1.5s.
        let bin = fixture("slow.sh", "sleep 0.3; echo done");
        let started = Instant::now();
        let checks = with_claude_bin(&bin, || {
            run_checks(
                1,
                2,
                vec![(
                    "p1".into(),
                    LaunchOptions {
                        cwd: "/tmp".into(),
                        prompt: "hi".into(),
                        ..Default::default()
                    },
                )],
            )
        });
        assert!(started.elapsed() < Duration::from_millis(1_200));
        assert_eq!(checks.len(), CLI_CHECKS.len() + 2);
        let jobs = checks.iter().find(|c| c.name == "running jobs").unwrap();
        assert!(jobs.detail.contains("1 live / 2 total"));
        let profile = checks.iter().find(|c| c.name == "profile: p1").unwrap();
        assert!(profile.ok);
    }
}
