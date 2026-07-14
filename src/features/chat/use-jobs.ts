import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { events } from "@/lib/bindings";
import { fetchJobs } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";

/**
 * Live job summaries: the backend emits `jobs-changed` on every registry or
 * status change, which invalidates the list instead of polling.
 */
export function useJobs() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisten = events.jobsChanged.listen(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery({ queryKey: queryKeys.jobs, queryFn: fetchJobs });
}
