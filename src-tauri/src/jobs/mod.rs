pub mod commands;
pub mod completions;
pub mod events;
pub mod options;
pub mod ring_buffer;
pub mod settings_file;
pub mod spawn;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::ChildStdin;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

use events::JobEventPayload;
use ring_buffer::RingBuffer;

pub const RING_BUFFER_CAP: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Starting,
    Running,
    Idle,
    Completed,
    Stopped,
    Interrupted,
    Error,
}

impl JobStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            JobStatus::Completed | JobStatus::Stopped | JobStatus::Interrupted | JobStatus::Error
        )
    }
}

/// Wire event delivered over an attach channel: buffered replay first, then
/// live tail. Clients dedupe by `seq`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct JobEvent {
    pub seq: u64,
    pub payload: JobEventPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct JobSummary {
    pub job_id: String,
    pub session_id: Option<String>,
    pub pid: Option<u32>,
    pub status: JobStatus,
    pub cwd: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub permission_mode: Option<String>,
    pub created_at_ms: u64,
    /// CLI-reported cumulative session cost (`reported`, not estimated).
    pub cost_usd: Option<f64>,
    pub usage: Option<Value>,
}

/// Emitted whenever the registry or any job summary changes; the UI refetches
/// `list_jobs` instead of polling.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct JobsChanged {
    pub job_id: String,
}

pub struct Job {
    pub summary: JobSummary,
    pub buffer: RingBuffer<JobEventPayload>,
    pub channels: Vec<Channel<JobEvent>>,
    pub stdin: Option<ChildStdin>,
    /// Temp `--settings` file to delete when the process exits.
    pub settings_file: Option<PathBuf>,
    pub stop_requested: bool,
    pub interrupt_requested: bool,
}

impl Job {
    pub fn new(summary: JobSummary, stdin: Option<ChildStdin>, settings_file: Option<PathBuf>) -> Self {
        Self {
            summary,
            buffer: RingBuffer::new(RING_BUFFER_CAP),
            channels: Vec::new(),
            stdin,
            settings_file,
            stop_requested: false,
            interrupt_requested: false,
        }
    }

    /// Apply an event to the summary (status lifecycle, identity, cost),
    /// buffer it, and fan it out to attached channels. Returns true when the
    /// summary changed (caller emits `JobsChanged`).
    pub fn push_and_fanout(&mut self, payload: JobEventPayload) -> bool {
        let changed = self.apply(&payload);
        let seq = self.buffer.push(payload.clone());
        let event = JobEvent { seq, payload };
        // Dropped/closed subscribers are pruned on send failure.
        self.channels.retain(|ch| ch.send(event.clone()).is_ok());
        changed
    }

    fn apply(&mut self, payload: &JobEventPayload) -> bool {
        let summary = &mut self.summary;
        match payload {
            JobEventPayload::SessionStarted {
                session_id, model, ..
            } => {
                summary.session_id = Some(session_id.clone());
                if summary.model.is_none() && !model.is_empty() {
                    summary.model = Some(model.clone());
                }
                if !summary.status.is_terminal() {
                    summary.status = JobStatus::Running;
                }
                true
            }
            JobEventPayload::TextDelta { .. }
            | JobEventPayload::ThinkingDelta { .. }
            | JobEventPayload::ToolUseStart { .. }
            | JobEventPayload::ToolUse { .. }
            | JobEventPayload::UserMessage { .. }
                if matches!(summary.status, JobStatus::Starting | JobStatus::Idle) =>
            {
                summary.status = JobStatus::Running;
                true
            }
            JobEventPayload::TurnResult { cost_usd, usage, .. } => {
                if let Some(cost) = cost_usd {
                    summary.cost_usd = Some(*cost);
                }
                if usage.is_some() {
                    summary.usage = usage.clone();
                }
                if !summary.status.is_terminal() {
                    summary.status = JobStatus::Idle;
                }
                self.interrupt_requested = false;
                true
            }
            JobEventPayload::ProcessExit { code } => {
                summary.status = if self.stop_requested {
                    JobStatus::Stopped
                } else if self.interrupt_requested {
                    JobStatus::Interrupted
                } else if *code == Some(0) {
                    JobStatus::Completed
                } else {
                    JobStatus::Error
                };
                summary.pid = None;
                true
            }
            _ => false,
        }
    }
}

#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<HashMap<String, Arc<Mutex<Job>>>>,
}

impl JobRegistry {
    pub fn insert(&self, job: Job) -> Arc<Mutex<Job>> {
        let id = job.summary.job_id.clone();
        let arc = Arc::new(Mutex::new(job));
        self.jobs
            .lock()
            .expect("job registry poisoned")
            .insert(id, arc.clone());
        arc
    }

    pub fn get(&self, job_id: &str) -> Option<Arc<Mutex<Job>>> {
        self.jobs
            .lock()
            .expect("job registry poisoned")
            .get(job_id)
            .cloned()
    }

    pub fn summaries(&self) -> Vec<JobSummary> {
        let jobs = self.jobs.lock().expect("job registry poisoned");
        let mut summaries: Vec<JobSummary> = jobs
            .values()
            .map(|job| job.lock().expect("job poisoned").summary.clone())
            .collect();
        summaries.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        summaries
    }

    /// App-exit cleanup: hard-kill every live child and delete temp settings
    /// files. Called from `RunEvent::Exit`, so best-effort and non-blocking.
    pub fn kill_all(&self) {
        let jobs = self.jobs.lock().expect("job registry poisoned");
        for job in jobs.values() {
            let mut job = job.lock().expect("job poisoned");
            if !job.summary.status.is_terminal() {
                if let Some(pid) = job.summary.pid {
                    spawn::kill_pid(pid, true);
                }
                job.summary.status = JobStatus::Stopped;
            }
            if let Some(path) = job.settings_file.take() {
                settings_file::cleanup(&path);
            }
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_job() -> Job {
        Job::new(
            JobSummary {
                job_id: "j1".into(),
                session_id: None,
                pid: Some(42),
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
        )
    }

    fn session_started() -> JobEventPayload {
        JobEventPayload::SessionStarted {
            session_id: "ses_1".into(),
            model: "claude-sonnet-5".into(),
            cwd: "/tmp".into(),
            tools: vec![],
            slash_commands: vec![],
            agents: vec![],
        }
    }

    fn turn_result(cost: f64) -> JobEventPayload {
        JobEventPayload::TurnResult {
            subtype: "success".into(),
            is_error: false,
            cost_usd: Some(cost),
            usage: Some(serde_json::json!({"output_tokens": 10})),
            duration_ms: None,
            num_turns: None,
        }
    }

    #[test]
    fn lifecycle_starting_running_idle_completed() {
        let mut job = test_job();
        assert!(job.push_and_fanout(session_started()));
        assert_eq!(job.summary.status, JobStatus::Running);
        assert_eq!(job.summary.session_id.as_deref(), Some("ses_1"));
        assert_eq!(job.summary.model.as_deref(), Some("claude-sonnet-5"));

        assert!(job.push_and_fanout(turn_result(0.01)));
        assert_eq!(job.summary.status, JobStatus::Idle);
        assert_eq!(job.summary.cost_usd, Some(0.01));

        // Follow-up turn: delta flips back to running.
        assert!(job.push_and_fanout(JobEventPayload::TextDelta { text: "hi".into() }));
        assert_eq!(job.summary.status, JobStatus::Running);
        // A second delta while already running is not a summary change.
        assert!(!job.push_and_fanout(JobEventPayload::TextDelta { text: "!".into() }));

        assert!(job.push_and_fanout(turn_result(0.02)));
        assert_eq!(job.summary.cost_usd, Some(0.02));

        assert!(job.push_and_fanout(JobEventPayload::ProcessExit { code: Some(0) }));
        assert_eq!(job.summary.status, JobStatus::Completed);
        assert_eq!(job.summary.pid, None);
    }

    #[test]
    fn nonzero_exit_is_error_stop_requested_wins() {
        let mut job = test_job();
        job.push_and_fanout(JobEventPayload::ProcessExit { code: Some(1) });
        assert_eq!(job.summary.status, JobStatus::Error);

        let mut job = test_job();
        job.stop_requested = true;
        job.push_and_fanout(JobEventPayload::ProcessExit { code: Some(143) });
        assert_eq!(job.summary.status, JobStatus::Stopped);
    }

    #[test]
    fn exit_during_interrupt_is_interrupted_but_turn_result_clears_flag() {
        let mut job = test_job();
        job.interrupt_requested = true;
        job.push_and_fanout(turn_result(0.01));
        assert!(!job.interrupt_requested);
        job.push_and_fanout(JobEventPayload::ProcessExit { code: Some(1) });
        assert_eq!(job.summary.status, JobStatus::Error);

        let mut job = test_job();
        job.interrupt_requested = true;
        job.push_and_fanout(JobEventPayload::ProcessExit { code: Some(1) });
        assert_eq!(job.summary.status, JobStatus::Interrupted);
    }

    #[test]
    fn buffered_events_keep_seq_order() {
        let mut job = test_job();
        job.push_and_fanout(session_started());
        job.push_and_fanout(JobEventPayload::TextDelta { text: "a".into() });
        job.push_and_fanout(JobEventPayload::TextDelta { text: "b".into() });
        let seqs: Vec<u64> = job.buffer.iter().map(|(seq, _)| *seq).collect();
        assert_eq!(seqs, vec![0, 1, 2]);
    }

    #[test]
    fn registry_lists_newest_first_and_kill_all_marks_stopped() {
        let registry = JobRegistry::default();
        let mut a = test_job();
        a.summary.job_id = "a".into();
        a.summary.created_at_ms = 1;
        a.summary.pid = None;
        let mut b = test_job();
        b.summary.job_id = "b".into();
        b.summary.created_at_ms = 2;
        b.summary.pid = None;
        registry.insert(a);
        registry.insert(b);

        let ids: Vec<String> = registry.summaries().iter().map(|s| s.job_id.clone()).collect();
        assert_eq!(ids, vec!["b".to_string(), "a".to_string()]);

        registry.kill_all();
        assert!(registry
            .summaries()
            .iter()
            .all(|s| s.status == JobStatus::Stopped));
    }
}
