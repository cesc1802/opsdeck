use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::parser::meta::SessionMeta;
use crate::parser::normalize::TokenUsage;

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct WorkspaceTotals {
    pub session_count: u32,
    pub message_count: u32,
    pub tokens: TokenUsage,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProjectStats {
    pub project_id: String,
    pub name: String,
    pub session_count: u32,
    pub message_count: u32,
    pub total_tokens: u64,
    pub estimated_cost_usd: f64,
}

/// One model's slice of workspace tokens; `share` is 0..=1 of the total.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelUsage {
    pub model: String,
    pub total_tokens: u64,
    pub share: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct WorkspaceStats {
    pub totals: WorkspaceTotals,
    pub projects: Vec<ProjectStats>,
    pub models: Vec<ModelUsage>,
}

/// Per-project input for the fold: id, friendly name, and the same
/// `SessionMeta` values every other view reads — stats never re-derives
/// tokens or cost, so totals cannot drift from the session list/inspector.
pub struct ProjectSessions {
    pub project_id: String,
    pub name: String,
    pub sessions: Vec<SessionMeta>,
}

pub fn aggregate(inputs: &[ProjectSessions]) -> WorkspaceStats {
    let mut totals = WorkspaceTotals::default();
    let mut projects = Vec::with_capacity(inputs.len());
    let mut per_model: HashMap<&str, u64> = HashMap::new();

    for input in inputs {
        let mut project = ProjectStats {
            project_id: input.project_id.clone(),
            name: input.name.clone(),
            session_count: input.sessions.len() as u32,
            message_count: 0,
            total_tokens: 0,
            estimated_cost_usd: 0.0,
        };
        for session in &input.sessions {
            project.message_count += session.message_count;
            project.total_tokens += session.tokens.total();
            project.estimated_cost_usd += session.estimated_cost_usd;

            totals.session_count += 1;
            totals.message_count += session.message_count;
            totals.tokens.add(&session.tokens);
            totals.estimated_cost_usd += session.estimated_cost_usd;

            for mt in &session.model_tokens {
                *per_model.entry(mt.model.as_str()).or_default() += mt.total_tokens;
            }
        }
        if project.session_count > 0 {
            projects.push(project);
        }
    }

    projects.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.name.cmp(&b.name))
    });

    let model_total: u64 = per_model.values().sum();
    let mut models: Vec<ModelUsage> = per_model
        .into_iter()
        .map(|(model, total_tokens)| ModelUsage {
            model: model.to_string(),
            total_tokens,
            share: if model_total > 0 {
                total_tokens as f64 / model_total as f64
            } else {
                0.0
            },
        })
        .collect();
    models.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.model.cmp(&b.model))
    });

    WorkspaceStats {
        totals,
        projects,
        models,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::meta::ModelTokens;

    fn meta(project_id: &str, messages: u32, input: u64, output: u64, model: &str) -> SessionMeta {
        SessionMeta {
            session_id: format!("s-{project_id}-{messages}"),
            project_id: project_id.to_string(),
            started_at: None,
            ended_at: None,
            message_count: messages,
            tokens: TokenUsage {
                input_tokens: input,
                output_tokens: output,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
            estimated_cost_usd: 0.5,
            models: vec![model.to_string()],
            model_tokens: vec![ModelTokens {
                model: model.to_string(),
                total_tokens: input + output,
            }],
            cli_version: None,
            git_branch: None,
            cwd: None,
            preview: String::new(),
            is_active: false,
        }
    }

    fn inputs() -> Vec<ProjectSessions> {
        vec![
            ProjectSessions {
                project_id: "p1".into(),
                name: "alpha".into(),
                sessions: vec![
                    meta("p1", 4, 1000, 500, "claude-sonnet-5"),
                    meta("p1", 2, 200, 100, "claude-opus-4-8"),
                ],
            },
            ProjectSessions {
                project_id: "p2".into(),
                name: "beta".into(),
                sessions: vec![meta("p2", 10, 5000, 2500, "claude-sonnet-5")],
            },
            ProjectSessions {
                project_id: "p3".into(),
                name: "empty".into(),
                sessions: vec![],
            },
        ]
    }

    #[test]
    fn totals_equal_the_sum_of_session_metas() {
        let stats = aggregate(&inputs());
        assert_eq!(stats.totals.session_count, 3);
        assert_eq!(stats.totals.message_count, 16);
        assert_eq!(stats.totals.tokens.input_tokens, 6200);
        assert_eq!(stats.totals.tokens.output_tokens, 3100);
        assert!((stats.totals.estimated_cost_usd - 1.5).abs() < 1e-9);

        // Per-project rows must sum to the same totals (consistency invariant).
        let project_tokens: u64 = stats.projects.iter().map(|p| p.total_tokens).sum();
        assert_eq!(project_tokens, stats.totals.tokens.total());
        let project_cost: f64 = stats.projects.iter().map(|p| p.estimated_cost_usd).sum();
        assert!((project_cost - stats.totals.estimated_cost_usd).abs() < 1e-9);

        // Per-model rows must cover the same token pool as the totals.
        let model_tokens: u64 = stats.models.iter().map(|m| m.total_tokens).sum();
        assert_eq!(model_tokens, stats.totals.tokens.total());
    }

    #[test]
    fn projects_sort_by_tokens_and_empty_ones_are_dropped() {
        let stats = aggregate(&inputs());
        let names: Vec<&str> = stats.projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["beta", "alpha"]);
    }

    #[test]
    fn model_shares_sum_to_one() {
        let stats = aggregate(&inputs());
        assert_eq!(stats.models.len(), 2);
        assert_eq!(stats.models[0].model, "claude-sonnet-5");
        assert_eq!(stats.models[0].total_tokens, 9000);
        let share_sum: f64 = stats.models.iter().map(|m| m.share).sum();
        assert!((share_sum - 1.0).abs() < 1e-9);
    }

    #[test]
    fn empty_workspace_produces_zeroed_stats() {
        let stats = aggregate(&[]);
        assert_eq!(stats.totals.session_count, 0);
        assert!(stats.projects.is_empty());
        assert!(stats.models.is_empty());
        assert_eq!(stats.totals.estimated_cost_usd, 0.0);
    }
}
