use serde::{Deserialize, Serialize};

use crate::parser::normalize::TokenUsage;

/// USD per 1M tokens for one model family, matched by substring on the model id.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelPricing {
    pub model_match: String,
    pub input: f64,
    pub output: f64,
    pub cache_creation: f64,
    pub cache_read: f64,
}

/// Hardcoded approximate rates. Labeled estimated: rates drift and are not
/// fetched live; the UI must present costs as estimates.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PricingTable {
    pub rates: Vec<ModelPricing>,
    pub default_model_match: String,
    pub disclaimer: String,
}

pub fn pricing_table() -> PricingTable {
    PricingTable {
        rates: vec![
            ModelPricing {
                model_match: "opus".into(),
                input: 15.0,
                output: 75.0,
                cache_creation: 18.75,
                cache_read: 1.5,
            },
            ModelPricing {
                model_match: "sonnet".into(),
                input: 3.0,
                output: 15.0,
                cache_creation: 3.75,
                cache_read: 0.3,
            },
            ModelPricing {
                model_match: "haiku".into(),
                input: 0.8,
                output: 4.0,
                cache_creation: 1.0,
                cache_read: 0.08,
            },
        ],
        default_model_match: "sonnet".into(),
        disclaimer: "estimated".into(),
    }
}

pub fn rate_for<'a>(table: &'a PricingTable, model: &str) -> &'a ModelPricing {
    let model = model.to_ascii_lowercase();
    table
        .rates
        .iter()
        .find(|r| model.contains(&r.model_match))
        .unwrap_or_else(|| {
            table
                .rates
                .iter()
                .find(|r| r.model_match == table.default_model_match)
                .expect("default rate present in table")
        })
}

pub fn cost_usd(table: &PricingTable, model: &str, usage: &TokenUsage) -> f64 {
    let rate = rate_for(table, model);
    (usage.input_tokens as f64 * rate.input
        + usage.output_tokens as f64 * rate.output
        + usage.cache_creation_input_tokens as f64 * rate.cache_creation
        + usage.cache_read_input_tokens as f64 * rate.cache_read)
        / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(input: u64, output: u64, create: u64, read: u64) -> TokenUsage {
        TokenUsage {
            input_tokens: input,
            output_tokens: output,
            cache_creation_input_tokens: create,
            cache_read_input_tokens: read,
        }
    }

    #[test]
    fn matches_model_family_by_substring() {
        let table = pricing_table();
        assert_eq!(rate_for(&table, "claude-opus-4-8").model_match, "opus");
        assert_eq!(rate_for(&table, "claude-haiku-4-5").model_match, "haiku");
        assert_eq!(rate_for(&table, "CLAUDE-SONNET-5").model_match, "sonnet");
    }

    #[test]
    fn unknown_model_falls_back_to_sonnet() {
        let table = pricing_table();
        assert_eq!(rate_for(&table, "some-future-model").model_match, "sonnet");
    }

    #[test]
    fn cost_math_matches_known_rates() {
        let table = pricing_table();
        // 1M of each bucket on sonnet: 3 + 15 + 3.75 + 0.3
        let one_million_each = usage(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        let cost = cost_usd(&table, "claude-sonnet-5", &one_million_each);
        assert!((cost - 22.05).abs() < 1e-9);

        // opus: 1000 in, 500 out => 0.015 + 0.0375
        let small = usage(1000, 500, 0, 0);
        let cost = cost_usd(&table, "claude-opus-4-8", &small);
        assert!((cost - 0.0525).abs() < 1e-9);
    }
}
