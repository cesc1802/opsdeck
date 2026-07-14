import type { ProjectStats } from "@/lib/bindings";

export type ProjectSortKey =
  | "name"
  | "session_count"
  | "message_count"
  | "total_tokens"
  | "estimated_cost_usd";

/** Sort project rows without mutating the input. Numeric keys default to
 * descending (biggest first); name is alphabetical. Ties break by name so
 * the order is stable across refetches. */
export function sortProjects(
  rows: ProjectStats[],
  key: ProjectSortKey,
  descending: boolean,
): ProjectStats[] {
  const sorted = [...rows].sort((a, b) => {
    const byKey =
      key === "name"
        ? a.name.localeCompare(b.name)
        : a[key] - b[key];
    const primary = descending ? -byKey : byKey;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  });
  return sorted;
}

/** Share of a total as a percent string; sub-1% values stay visible. */
export function formatShare(share: number): string {
  if (share <= 0) return "0%";
  const percent = share * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/** Bar width for a row relative to the largest row, in percent (0-100). */
export function barWidth(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.round((value / max) * 100));
}
