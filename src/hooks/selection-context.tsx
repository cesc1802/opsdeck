import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Selection {
  projectId: string | null;
  sessionId: string | null;
  selectProject: (projectId: string) => void;
  selectSession: (sessionId: string) => void;
}

const SelectionContext = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const selectProject = useCallback((next: string) => {
    setProjectId(next);
    setSessionId(null);
  }, []);
  const selectSession = useCallback((next: string) => {
    setSessionId(next);
  }, []);

  const value = useMemo(
    () => ({ projectId, sessionId, selectProject, selectSession }),
    [projectId, sessionId, selectProject, selectSession],
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
