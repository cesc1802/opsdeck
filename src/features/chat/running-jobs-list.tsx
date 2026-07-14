import { useEffect, useState } from "react";
import { useSelection } from "@/hooks/selection-context";
import { statusColor } from "@/lib/status-colors";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatElapsed, isTerminalStatus, jobLabel } from "./job-display";
import { useJobs } from "./use-jobs";

/**
 * Sidebar section listing live chat jobs. Hidden entirely while no jobs
 * exist; clicking a row switches the main pane to that chat.
 */
export function RunningJobsList() {
  const { mode, openChat } = useSelection();
  const { data: jobs } = useJobs();
  const activeJobId = mode.kind === "chat" ? mode.jobId : null;

  const hasLiveJob = jobs?.some((job) => !isTerminalStatus(job.status)) ?? false;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasLiveJob) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasLiveJob]);

  if (!jobs || jobs.length === 0) return null;

  return (
    <div className="border-b pb-2">
      <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("chat.jobs.title")}
      </div>
      <div className="px-2">
        {jobs.map((job) => {
          const status = statusColor(job.status);
          const terminal = isTerminalStatus(job.status);
          return (
            <button
              key={job.job_id}
              type="button"
              onClick={() => openChat(job.job_id)}
              title={job.cwd}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                job.job_id === activeJobId && "bg-accent",
              )}
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  status.dot,
                  job.status === "running" && "animate-pulse",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{jobLabel(job)}</span>
              {job.pid !== null && !terminal && (
                <span className="mono shrink-0 text-[10px] text-muted-foreground">
                  {job.pid}
                </span>
              )}
              <span
                className={cn("mono shrink-0 text-[10px]", status.text)}
              >
                {terminal
                  ? job.status
                  : formatElapsed(job.created_at_ms, now)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
