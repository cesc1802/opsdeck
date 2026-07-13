import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSessions } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { useSelection } from "@/hooks/selection-context";
import { cn } from "@/lib/utils";
import {
  SESSION_FILTERS,
  filterLabel,
  matchesFilter,
  type SessionFilter,
} from "./session-filters";
import { SessionRow } from "./session-row";

export function SessionList() {
  const { projectId, sessionId, selectSession } = useSelection();
  const [filter, setFilter] = useState<SessionFilter>("all");

  const { data: sessions, isPending, isError } = useQuery({
    queryKey: queryKeys.sessions(projectId ?? ""),
    queryFn: () => fetchSessions(projectId!),
    enabled: projectId !== null,
  });

  const filtered = useMemo(
    () => sessions?.filter((s) => matchesFilter(s, filter)) ?? [],
    [sessions, filter],
  );

  if (projectId === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {t("sessions.selectProject")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1 border-b px-2 py-2">
        {SESSION_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs hover:bg-accent",
              f === filter
                ? "bg-primary text-primary-foreground hover:bg-primary"
                : "text-muted-foreground",
            )}
          >
            {filterLabel(f)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isPending && (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}
        {isError && (
          <p className="px-1 text-sm text-destructive">{t("sessions.error")}</p>
        )}
        {sessions && filtered.length === 0 && (
          <p className="px-1 pt-2 text-sm text-muted-foreground">
            {sessions.length === 0
              ? t("sessions.empty")
              : t("sessions.emptyFiltered")}
          </p>
        )}
        {filtered.map((session) => (
          <SessionRow
            key={session.session_id}
            session={session}
            selected={session.session_id === sessionId}
            onSelect={() => selectSession(session.session_id)}
          />
        ))}
      </div>
    </div>
  );
}
