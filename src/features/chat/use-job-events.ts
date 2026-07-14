import { useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type JobEvent } from "@/lib/bindings";
import {
  emptyTimeline,
  reduceTimeline,
  type ChatTimeline,
} from "./chat-timeline-reducer";

interface JobEventsState {
  jobId: string | null;
  timeline: ChatTimeline;
  attachError: string | null;
}

/**
 * Attach to a job's event channel and fold replay + live tail into a
 * timeline. High-frequency deltas are micro-batched per animation frame so
 * each flush pays one timeline clone instead of one per delta.
 */
export function useJobEvents(jobId: string | null): {
  timeline: ChatTimeline;
  attachError: string | null;
} {
  const [state, setState] = useState<JobEventsState>({
    jobId,
    timeline: emptyTimeline(),
    attachError: null,
  });

  // Reset synchronously when the job changes (setState-during-render reset
  // pattern) so a stale timeline never renders against the new job.
  if (state.jobId !== jobId) {
    setState({ jobId, timeline: emptyTimeline(), attachError: null });
  }

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let pending: JobEvent[] = [];
    let frame: number | null = null;

    const flush = () => {
      frame = null;
      if (disposed || pending.length === 0) return;
      const batch = pending;
      pending = [];
      setState((prev) =>
        prev.jobId === jobId
          ? { ...prev, timeline: reduceTimeline(prev.timeline, batch) }
          : prev,
      );
    };

    const channel = new Channel<JobEvent>();
    channel.onmessage = (event) => {
      pending.push(event);
      frame ??= requestAnimationFrame(flush);
    };

    void commands.attachJob(jobId, channel).then((result) => {
      if (disposed || result.status !== "error") return;
      setState((prev) =>
        prev.jobId === jobId ? { ...prev, attachError: result.error } : prev,
      );
    });

    return () => {
      // No explicit close on Tauri channels: dropping the handler is enough;
      // the backend prunes the channel on its next failed send.
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [jobId]);

  return { timeline: state.timeline, attachError: state.attachError };
}
