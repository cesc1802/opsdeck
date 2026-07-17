import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LaunchOptions } from "@/lib/bindings";

/** What the main pane shows: history session, new-chat form, live chat,
 * or workspace stats. */
export type MainMode =
  | { kind: "session" }
  | { kind: "new-chat"; initial?: Partial<LaunchOptions> }
  | { kind: "chat"; jobId: string }
  | { kind: "stats" };

interface Selection {
  projectId: string | null;
  sessionId: string | null;
  mode: MainMode;
  selectProject: (projectId: string) => void;
  selectSession: (sessionId: string) => void;
  openNewChat: (initial?: Partial<LaunchOptions>) => void;
  openChat: (jobId: string) => void;
  openStats: () => void;
}

const SelectionContext = createContext<Selection | null>(null);

const ACTIVE_JOB_KEY = "opsdeck.activeJobId";

function initialMode(): MainMode {
  try {
    const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
    // Jobs do not survive an app restart, but a webview reload mid-run does:
    // restore the chat pane and let attach replay the buffer. A stale id
    // renders as a "job not found" state.
    if (jobId) return { kind: "chat", jobId };
  } catch {
    // localStorage unavailable — fall through.
  }
  return { kind: "session" };
}

function persistActiveJob(jobId: string | null) {
  try {
    if (jobId) {
      localStorage.setItem(ACTIVE_JOB_KEY, jobId);
    } else {
      localStorage.removeItem(ACTIVE_JOB_KEY);
    }
  } catch {
    // Best-effort persistence only.
  }
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<MainMode>(initialMode);

  const selectProject = useCallback((next: string) => {
    setProjectId(next);
    setSessionId(null);
    setMode({ kind: "session" });
    persistActiveJob(null);
  }, []);
  const selectSession = useCallback((next: string) => {
    setSessionId(next);
    setMode({ kind: "session" });
    persistActiveJob(null);
  }, []);
  const openNewChat = useCallback((initial?: Partial<LaunchOptions>) => {
    setMode({ kind: "new-chat", initial });
    persistActiveJob(null);
  }, []);
  const openChat = useCallback((jobId: string) => {
    setMode({ kind: "chat", jobId });
    persistActiveJob(jobId);
  }, []);
  const openStats = useCallback(() => {
    setMode({ kind: "stats" });
    persistActiveJob(null);
  }, []);

  const value = useMemo(
    () => ({
      projectId,
      sessionId,
      mode,
      selectProject,
      selectSession,
      openNewChat,
      openChat,
      openStats,
    }),
    [
      projectId,
      sessionId,
      mode,
      selectProject,
      selectSession,
      openNewChat,
      openChat,
      openStats,
    ],
  );
  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) {
    throw new Error("useSelection requires a SelectionProvider ancestor");
  }
  return selection;
}
