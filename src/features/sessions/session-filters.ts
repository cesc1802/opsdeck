import type { SessionMeta } from "@/lib/bindings";
import { t, type I18nKey } from "@/lib/i18n";

export type SessionFilter = "all" | "today" | "7d" | "30d" | "running";

export const SESSION_FILTERS: SessionFilter[] = [
  "all",
  "today",
  "7d",
  "30d",
  "running",
];

const FILTER_LABEL_KEYS: Record<SessionFilter, I18nKey> = {
  all: "sessions.filter.all",
  today: "sessions.filter.today",
  "7d": "sessions.filter.7d",
  "30d": "sessions.filter.30d",
  running: "sessions.filter.running",
};

export function filterLabel(filter: SessionFilter): string {
  return t(FILTER_LABEL_KEYS[filter]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function lastActivity(session: SessionMeta): number {
  const iso = session.ended_at ?? session.started_at;
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function matchesFilter(
  session: SessionMeta,
  filter: SessionFilter,
  now = Date.now(),
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return session.is_active;
    case "today": {
      const activity = new Date(lastActivity(session));
      const today = new Date(now);
      return (
        activity.getFullYear() === today.getFullYear() &&
        activity.getMonth() === today.getMonth() &&
        activity.getDate() === today.getDate()
      );
    }
    case "7d":
      return now - lastActivity(session) <= 7 * DAY_MS;
    case "30d":
      return now - lastActivity(session) <= 30 * DAY_MS;
  }
}
