import { useQuery } from "@tanstack/react-query";
import { fetchStats } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";

/** Workspace stats query. LiveRefreshProvider invalidates this key on every
 * sessions-changed event, so stats stay current while sessions run. */
export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: fetchStats,
  });
}
