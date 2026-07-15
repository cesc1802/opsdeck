use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::AppHandle;
use tauri_specta::Event;

use super::events::{bridge_line, JobEventPayload};
use super::options::{self, LaunchOptions};
use super::settings_file;
use super::{now_ms, Job, JobStatus, JobSummary, JobsChanged};
use crate::state::AppState;

const STOP_ESCALATION: Duration = Duration::from_secs(3);

fn emit_jobs_changed(app: &AppHandle, job_id: &str) {
    let payload = JobsChanged {
        job_id: job_id.to_string(),
    };
    if let Err(e) = payload.emit(app) {
        eprintln!("[opsdeck] jobs-changed emit failed: {e}");
    }
}

/// Send a signal to a process. `force` = SIGKILL, otherwise SIGTERM.
#[cfg(unix)]
pub fn kill_pid(pid: u32, force: bool) {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    unsafe {
        libc::kill(pid as libc::pid_t, signal);
    }
}

#[cfg(not(unix))]
pub fn kill_pid(_pid: u32, _force: bool) {}

fn user_message_line(text: &str) -> String {
    serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
    })
    .to_string()
}

fn interrupt_line() -> String {
    serde_json::json!({
        "type": "control_request",
        "request_id": format!("interrupt-{}", now_ms()),
        "request": { "subtype": "interrupt" }
    })
    .to_string()
}

fn write_stdin_line(job: &mut Job, line: &str) -> Result<(), String> {
    let Some(stdin) = job.stdin.as_mut() else {
        return Err("job stdin is closed".into());
    };
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("cannot write to job stdin: {e}"))
}

/// Drain one stdio pipe into the job: bridge each line, buffer + fan out,
/// notify on summary changes. Runs on a dedicated thread — never on the
/// command thread — so pipes cannot deadlock.
fn pump_lines(
    reader: impl Read,
    job: &Arc<Mutex<Job>>,
    stderr: bool,
    on_change: &dyn Fn(),
) {
    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        let payloads: Vec<JobEventPayload> = if stderr {
            if line.trim().is_empty() {
                continue;
            }
            vec![JobEventPayload::Stderr { line }]
        } else {
            bridge_line(&line)
        };
        for payload in payloads {
            let changed = job.lock().expect("job poisoned").push_and_fanout(payload);
            if changed {
                on_change();
            }
        }
    }
}

/// Validate, spawn `claude`, register the job, and start the pump threads.
pub fn create_job(
    app: &AppHandle,
    state: &AppState,
    mut options: LaunchOptions,
) -> Result<JobSummary, String> {
    options::normalize_options(&mut options);
    let errors = options::validate_options(&options);
    if !errors.is_empty() {
        let details: Vec<String> = errors
            .iter()
            .map(|e| format!("{}: {}", e.field, e.message))
            .collect();
        return Err(format!("invalid launch options — {}", details.join("; ")));
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    let settings_path = settings_file::write_if_needed(&job_id, &options)?;
    let args = options::build_args(&options, settings_path.as_deref());
    let cwd = options::expand_path(&options.cwd);

    let spawned = Command::new("claude")
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            if let Some(path) = &settings_path {
                settings_file::cleanup(path);
            }
            return Err(format!("failed to spawn claude: {e}"));
        }
    };

    let pid = child.id();
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let stdin = child.stdin.take();

    let summary = JobSummary {
        job_id: job_id.clone(),
        session_id: None,
        pid: Some(pid),
        status: JobStatus::Starting,
        cwd: cwd.to_string_lossy().into_owned(),
        name: options.name.clone(),
        model: options.model.clone(),
        effort: options.effort.clone(),
        permission_mode: options.permission_mode.clone(),
        created_at_ms: now_ms(),
        cost_usd: None,
        usage: None,
    };
    let mut job = Job::new(summary.clone(), stdin, settings_path);

    // A seeded prompt (profile / Resume / Fork) goes over stdin as the first
    // user message (stream-json input mode), buffered too so attach replay
    // shows the user's side. Without one the job waits for the composer; the
    // CLI emits nothing but hook events until the first message arrives.
    if !options.prompt.trim().is_empty() {
        write_stdin_line(&mut job, &user_message_line(&options.prompt))?;
        job.push_and_fanout(JobEventPayload::UserMessage {
            text: options.prompt.clone(),
        });
    }

    let job_arc = state.jobs.insert(job);
    emit_jobs_changed(app, &job_id);

    let notify = {
        let app = app.clone();
        let job_id = job_id.clone();
        move || emit_jobs_changed(&app, &job_id)
    };
    {
        let job = job_arc.clone();
        let notify = notify.clone();
        std::thread::spawn(move || pump_lines(stdout, &job, false, &notify));
    }
    {
        let job = job_arc.clone();
        let notify = notify.clone();
        std::thread::spawn(move || pump_lines(stderr, &job, true, &notify));
    }
    {
        let job = job_arc.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            let mut guard = job.lock().expect("job poisoned");
            guard.stdin = None;
            if let Some(path) = guard.settings_file.take() {
                settings_file::cleanup(&path);
            }
            guard.push_and_fanout(JobEventPayload::ProcessExit { code });
            drop(guard);
            notify();
        });
    }

    Ok(summary)
}

pub fn send_user_message(
    app: &AppHandle,
    state: &AppState,
    job_id: &str,
    text: &str,
) -> Result<(), String> {
    let job = state.jobs.get(job_id).ok_or("unknown job")?;
    let changed = {
        let mut job = job.lock().expect("job poisoned");
        write_stdin_line(&mut job, &user_message_line(text))?;
        job.push_and_fanout(JobEventPayload::UserMessage {
            text: text.to_string(),
        })
    };
    if changed {
        emit_jobs_changed(app, job_id);
    }
    Ok(())
}

/// End the current turn without killing the process (stdin control message).
pub fn interrupt_job(state: &AppState, job_id: &str) -> Result<(), String> {
    let job = state.jobs.get(job_id).ok_or("unknown job")?;
    let mut job = job.lock().expect("job poisoned");
    job.interrupt_requested = true;
    write_stdin_line(&mut job, &interrupt_line())
}

/// SIGTERM now; escalate to SIGKILL after 3s if the process is still alive.
pub fn stop_job(app: &AppHandle, state: &AppState, job_id: &str) -> Result<(), String> {
    let job = state.jobs.get(job_id).ok_or("unknown job")?;
    let pid = {
        let mut guard = job.lock().expect("job poisoned");
        if guard.summary.status.is_terminal() {
            return Ok(());
        }
        guard.stop_requested = true;
        guard.summary.pid
    };
    emit_jobs_changed(app, job_id);
    let Some(pid) = pid else { return Ok(()) };
    kill_pid(pid, false);

    let job = job.clone();
    std::thread::spawn(move || {
        std::thread::sleep(STOP_ESCALATION);
        let guard = job.lock().expect("job poisoned");
        // The waiter thread flips status on exit; still alive means TERM was
        // ignored.
        if !guard.summary.status.is_terminal() {
            kill_pid(pid, true);
        }
    });
    Ok(())
}

pub fn attach_job(
    state: &AppState,
    job_id: &str,
    channel: tauri::ipc::Channel<super::JobEvent>,
) -> Result<(), String> {
    let job = state.jobs.get(job_id).ok_or("unknown job")?;
    let mut job = job.lock().expect("job poisoned");
    // Replay the full buffer in seq order, then register for the live tail.
    // The lock spans both, so no event can slip between replay and register.
    for (seq, payload) in job.buffer.iter() {
        let event = super::JobEvent {
            seq: *seq,
            payload: payload.clone(),
        };
        if channel.send(event).is_err() {
            return Err("attach channel closed".into());
        }
    }
    job.channels.push(channel);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn test_job_arc() -> Arc<Mutex<Job>> {
        Arc::new(Mutex::new(Job::new(
            JobSummary {
                job_id: "j1".into(),
                session_id: None,
                pid: None,
                status: JobStatus::Starting,
                cwd: "/tmp".into(),
                name: None,
                model: None,
                effort: None,
                permission_mode: None,
                created_at_ms: 0,
                cost_usd: None,
                usage: None,
            },
            None,
            None,
        )))
    }

    #[test]
    fn pump_bridges_stdout_and_notifies_on_changes() {
        let job = test_job_arc();
        let changes = Arc::new(Mutex::new(0u32));
        let counter = changes.clone();
        let input = concat!(
            r#"{"type":"system","subtype":"init","session_id":"s","model":"m","cwd":"/tmp","tools":[]}"#,
            "\n",
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}"#,
            "\n",
            r#"{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.5}"#,
            "\n",
        );
        pump_lines(Cursor::new(input), &job, false, &|| {
            *counter.lock().unwrap() += 1;
        });
        let guard = job.lock().unwrap();
        assert_eq!(guard.summary.status, JobStatus::Idle);
        assert_eq!(guard.summary.cost_usd, Some(0.5));
        assert_eq!(guard.buffer.len(), 3);
        // session_started + turn_result changed the summary; the delta did not
        // (status was already running after session start).
        assert_eq!(*changes.lock().unwrap(), 2);
    }

    #[test]
    fn pump_wraps_stderr_lines_and_skips_blanks() {
        let job = test_job_arc();
        pump_lines(Cursor::new("boom\n\nwarn\n"), &job, true, &|| {});
        let guard = job.lock().unwrap();
        let lines: Vec<String> = guard
            .buffer
            .iter()
            .filter_map(|(_, p)| match p {
                JobEventPayload::Stderr { line } => Some(line.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(lines, vec!["boom", "warn"]);
    }

    #[test]
    fn stdin_message_shapes() {
        let msg: serde_json::Value = serde_json::from_str(&user_message_line("hey")).unwrap();
        assert_eq!(msg["type"], "user");
        assert_eq!(msg["message"]["content"][0]["text"], "hey");

        let interrupt: serde_json::Value = serde_json::from_str(&interrupt_line()).unwrap();
        assert_eq!(interrupt["type"], "control_request");
        assert_eq!(interrupt["request"]["subtype"], "interrupt");
    }
}
