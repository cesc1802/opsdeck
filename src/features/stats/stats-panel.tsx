import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceStats } from "@/lib/bindings";
import { formatCost, formatTokens, totalTokens } from "@/lib/format";
import { t, type I18nKey } from "@/lib/i18n";
import {
  barWidth,
  formatShare,
  sortProjects,
  type ProjectSortKey,
} from "./stats-model";
import { useStats } from "./use-stats";

function EstimatedBadge() {
  return (
    <Badge
      variant="secondary"
      className="bg-dash-accent-subtle px-1.5 text-[10px] font-normal"
    >
      {t("cost.estimated")}
    </Badge>
  );
}

function TotalTile({
  labelKey,
  value,
  estimated,
}: {
  labelKey: I18nKey;
  value: string;
  estimated?: boolean;
}) {
  return (
    <div className="dash-panel space-y-1 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {t(labelKey)}
        {estimated && <EstimatedBadge />}
      </div>
      <div className="mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SortHeader({
  labelKey,
  sortKey,
  active,
  descending,
  onSort,
  align = "right",
}: {
  labelKey: I18nKey;
  sortKey: ProjectSortKey;
  active: boolean;
  descending: boolean;
  onSort: (key: ProjectSortKey) => void;
  align?: "left" | "right";
}) {
  const Arrow = descending ? ArrowDown : ArrowUp;
  return (
    <th className={align === "left" ? "text-left" : "text-right"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        {t(labelKey)}
        {active && <Arrow className="size-3" />}
      </button>
    </th>
  );
}

function ProjectTable({ stats }: { stats: WorkspaceStats }) {
  const [sort, setSort] = useState<{ key: ProjectSortKey; descending: boolean }>(
    { key: "total_tokens", descending: true },
  );

  function toggleSort(key: ProjectSortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, descending: !prev.descending }
        : { key, descending: key !== "name" },
    );
  }

  const rows = sortProjects(stats.projects, sort.key, sort.descending);
  const maxTokens = Math.max(...stats.projects.map((p) => p.total_tokens), 0);

  return (
    <section className="dash-panel p-3">
      <h3 className="mb-2 text-sm font-semibold tracking-tight">
        {t("stats.projects.title")}
      </h3>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <SortHeader
              labelKey="stats.projects.project"
              sortKey="name"
              active={sort.key === "name"}
              descending={sort.descending}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              labelKey="stats.projects.sessions"
              sortKey="session_count"
              active={sort.key === "session_count"}
              descending={sort.descending}
              onSort={toggleSort}
            />
            <SortHeader
              labelKey="stats.projects.messages"
              sortKey="message_count"
              active={sort.key === "message_count"}
              descending={sort.descending}
              onSort={toggleSort}
            />
            <SortHeader
              labelKey="stats.projects.tokens"
              sortKey="total_tokens"
              active={sort.key === "total_tokens"}
              descending={sort.descending}
              onSort={toggleSort}
            />
            <SortHeader
              labelKey="stats.projects.cost"
              sortKey="estimated_cost_usd"
              active={sort.key === "estimated_cost_usd"}
              descending={sort.descending}
              onSort={toggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((project) => (
            <tr
              key={project.project_id}
              className="hover:bg-dash-surface-hover"
            >
              <td
                className="max-w-0 truncate py-1.5 pr-2 font-medium"
                title={project.name}
              >
                {project.name}
              </td>
              <td className="mono py-1.5 pl-2 text-right tabular-nums">
                {project.session_count}
              </td>
              <td className="mono py-1.5 pl-2 text-right tabular-nums">
                {project.message_count}
              </td>
              <td className="py-1.5 pl-2 text-right">
                <span className="mono tabular-nums">
                  {formatTokens(project.total_tokens)}
                </span>
                <div className="mt-0.5 h-1 w-full rounded-full bg-dash-accent-subtle">
                  <div
                    className="h-1 rounded-full bg-dash-accent"
                    style={{
                      width: `${barWidth(project.total_tokens, maxTokens)}%`,
                    }}
                  />
                </div>
              </td>
              <td className="mono py-1.5 pl-2 text-right align-top tabular-nums">
                {formatCost(project.estimated_cost_usd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ModelDistribution({ stats }: { stats: WorkspaceStats }) {
  if (stats.models.length === 0) return null;
  return (
    <section className="dash-panel space-y-2 p-3">
      <h3 className="text-sm font-semibold tracking-tight">
        {t("stats.models.title")}
      </h3>
      <ul className="space-y-2">
        {stats.models.map((model) => (
          <li key={model.model} className="space-y-0.5 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="mono min-w-0 truncate" title={model.model}>
                {model.model}
              </span>
              <span className="mono shrink-0 tabular-nums text-muted-foreground">
                {formatTokens(model.total_tokens)} · {formatShare(model.share)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-dash-accent-subtle">
              <div
                className="h-1.5 rounded-full bg-dash-accent"
                style={{ width: `${Math.max(1, model.share * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[70px]" />
        ))}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  );
}

export function StatsPanel() {
  const { data: stats, isPending, isError } = useStats();

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("stats.title")}
        </h2>
        {isPending && <StatsSkeleton />}
        {isError && (
          <p className="text-sm text-destructive">{t("stats.error")}</p>
        )}
        {stats && stats.totals.session_count === 0 && (
          <p className="text-sm text-muted-foreground">{t("stats.empty")}</p>
        )}
        {stats && stats.totals.session_count > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TotalTile
                labelKey="stats.totals.sessions"
                value={String(stats.totals.session_count)}
              />
              <TotalTile
                labelKey="stats.totals.messages"
                value={String(stats.totals.message_count)}
              />
              <TotalTile
                labelKey="stats.totals.tokens"
                value={formatTokens(totalTokens(stats.totals.tokens))}
              />
              <TotalTile
                labelKey="stats.totals.cost"
                value={formatCost(stats.totals.estimated_cost_usd)}
                estimated
              />
            </div>
            <ProjectTable stats={stats} />
            <ModelDistribution stats={stats} />
          </>
        )}
      </div>
    </ScrollArea>
  );
}
