import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSelection } from "@/hooks/selection-context";
import { useJobEvents } from "./use-job-events";
import type { ChatTimeline } from "./chat-timeline-reducer";

interface LiveChat {
  jobId: string | null;
  timeline: ChatTimeline;
  attachError: string | null;
}

const LiveChatContext = createContext<LiveChat | null>(null);

/**
 * Attaches to the selected job exactly once and shares the folded timeline
 * between the chat view and the inspector, so switching panels never
 * re-replays the event buffer.
 */
export function LiveChatProvider({ children }: { children: ReactNode }) {
  const { mode } = useSelection();
  const jobId = mode.kind === "chat" ? mode.jobId : null;
  const { timeline, attachError } = useJobEvents(jobId);

  const value = useMemo(
    () => ({ jobId, timeline, attachError }),
    [jobId, timeline, attachError],
  );
  return (
    <LiveChatContext.Provider value={value}>
      {children}
    </LiveChatContext.Provider>
  );
}

export function useLiveChat(): LiveChat {
  const liveChat = useContext(LiveChatContext);
  if (!liveChat) {
    throw new Error("useLiveChat requires a LiveChatProvider ancestor");
  }
  return liveChat;
}
