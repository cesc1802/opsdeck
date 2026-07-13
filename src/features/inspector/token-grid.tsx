import { formatCost, formatTokens } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TokenUsage } from "@/lib/bindings";
import type { CostBreakdown } from "./lib/derive";

const CATEGORIES = [
  { key: "input", labelKey: "inspector.tokens.input", color: "bg-sky-500" },
  { key: "output", labelKey: "inspector.tokens.output", color: "bg-violet-500" },
  {
    key: "cacheCreation",
    labelKey: "inspector.tokens.cacheCreate",
    color: "bg-amber-500",
  },
  {
    key: "cacheRead",
    labelKey: "inspector.tokens.cacheRead",
    color: "bg-emerald-500",
  },
] as const;

const TOKEN_FIELDS: Record<(typeof CATEGORIES)[number]["key"], keyof TokenUsage> = {
  input: "input_tokens",
  output: "output_tokens",
  cacheCreation: "cache_creation_input_tokens",
  cacheRead: "cache_read_input_tokens",
};

export function TokenGrid({
  tokens,
  cost,
}: {
  tokens: TokenUsage;
  cost: CostBreakdown;
}) {
  const totalCost = cost.input + cost.output + cost.cacheCreation + cost.cacheRead;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("inspector.tokens.title")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {CATEGORIES.map(({ key, labelKey, color }) => (
          <div key={key} className="rounded-md border px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${color}`} />
              {t(labelKey)}
            </div>
            <div className="text-sm font-medium tabular-nums">
              {formatTokens(tokens[TOKEN_FIELDS[key]])}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("inspector.cost.title")} ({t("cost.estimated")})
        </span>
        <span className="font-medium tabular-nums text-foreground">
          {formatCost(totalCost)}
        </span>
      </div>
      {totalCost > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          {CATEGORIES.map(({ key, color }) => (
            <div
              key={key}
              className={color}
              style={{ width: `${(cost[key] / totalCost) * 100}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
