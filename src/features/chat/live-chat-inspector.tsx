import { useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { formatCost } from "@/lib/format";
import { statusColor } from "@/lib/status-colors";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useJobs } from "./use-jobs";
import { useLiveChat } from "./live-chat-context";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="mono min-w-0 truncate" title={value}>
        {value}
      </span>
    </div>
  );
}

/** Inspector content while a live chat is selected: job facts + tool usage. */
export function LiveChatInspector() {
  const { jobId, timeline } = useLiveChat();
  const { data: jobs } = useJobs();
  const job = jobs?.find((candidate) => candidate.job_id === jobId) ?? null;

  const toolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of timeline.items) {
      if (item.kind !== "message") continue;
      for (const block of item.message.blocks) {
        if (block.type === "tool_use") {
          counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [timeline.items]);

  if (!job) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {t("inspector.empty")}
      </div>
    );
  }

  const status = statusColor(job.status);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="dash-panel space-y-2 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", status.dot)} aria-hidden />
          <span className="text-sm font-medium">{t("chat.live.title")}</span>
          <span
            className={cn(
              "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium",
              status.badge,
            )}
          >
            {job.status}
          </span>
        </div>
        <Separator />
        {timeline.sessionId && (
          <Row label={t("chat.live.session")} value={timeline.sessionId} />
        )}
        {job.model && <Row label={t("chat.live.model")} value={job.model} />}
        <Row label={t("chat.live.cwd")} value={job.cwd} />
        {job.cost_usd !== null && (
          <Row
            label={t("chat.live.cost")}
            value={`${formatCost(job.cost_usd)} · ${t("chat.view.costReported")}`}
          />
        )}
        {timeline.lastTurn !== null && timeline.lastTurn.num_turns !== null && (
          <Row
            label={t("chat.live.turns")}
            value={String(timeline.lastTurn.num_turns)}
          />
        )}
        {timeline.tools.length > 0 && (
          <Row
            label={t("chat.live.toolsAvailable")}
            value={String(timeline.tools.length)}
          />
        )}
      </div>

      {toolCounts.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("chat.live.toolUsage")}
          </div>
          <div className="space-y-1">
            {toolCounts.map(([name, count]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-accent"
              >
                <span className="mono min-w-0 truncate">{name}</span>
                <span className="mono shrink-0 tabular-nums text-muted-foreground">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
