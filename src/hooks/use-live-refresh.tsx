import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events } from "@/lib/bindings";
import { queryKeys } from "@/lib/query-keys";

interface LiveRefresh {
  live: boolean;
  setLive: (live: boolean) => void;
  /** Manual sync: refetch everything regardless of the Live toggle. */
  syncNow: () => void;
}

const LiveRefreshContext = createContext<LiveRefresh | null>(null);

/**
 * Bridges the Rust file watcher to TanStack Query: each SessionsChanged
 * event (already debounced 500ms on the Rust side) invalidates the affected
 * queries so open views silently refetch.
 */
export function LiveRefreshProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(true);
  const liveRef = useRef(live);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    const unlisten = events.sessionsChanged.listen(({ payload }) => {
      if (!liveRef.current) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessions(payload.project_id),
      });
      if (payload.session_id) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.session(payload.project_id, payload.session_id),
        });
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  const syncNow = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo(() => ({ live, setLive, syncNow }), [live, syncNow]);
  return (
    <LiveRefreshContext.Provider value={value}>
      {children}
    </LiveRefreshContext.Provider>
  );
}

export function useLiveRefresh(): LiveRefresh {
  const context = useContext(LiveRefreshContext);
  if (!context) {
    throw new Error("useLiveRefresh requires a LiveRefreshProvider ancestor");
  }
  return context;
}
