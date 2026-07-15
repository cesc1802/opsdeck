import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { CircleStop, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MessageItem } from "@/features/messages/message-item";
import { TerminalOutput } from "@/features/messages/blocks/terminal-output";
import type { JobSummary } from "@/lib/bindings";
import { stopJob } from "@/lib/ipc";
import { formatCost } from "@/lib/format";
import { statusColor } from "@/lib/status-colors";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatItem, TurnInfo } from "./chat-timeline-reducer";
import { isTerminalStatus } from "./job-display";
import { useJobs } from "./use-jobs";
import { useLiveChat } from "./live-chat-context";
import { ChatComposer } from "./chat-composer";

function TurnRow({ turn }: { turn: TurnInfo }) {
  const parts: string[] = [turn.subtype];
  if (turn.duration_ms !== null) {
    parts.push(`${(turn.duration_ms / 1000).toFixed(1)}s`);
  }
  if (turn.num_turns !== null) {
    parts.push(`${turn.num_turns} ${t("chat.view.turnCount")}`);
  }
  if (turn.cost_usd !== null) {
    parts.push(formatCost(turn.cost_usd));
  }
  return (
    <div
      className={cn(
        "mono flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-[11px]",
        turn.is_error ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
      )}
    >
      {turn.is_error && <TriangleAlert className="size-3 shrink-0" />}
      <span className="truncate">{parts.join(" · ")}</span>
    </div>
  );
}

function SystemRow({
  tone,
  text,
}: {
  tone: "notice" | "stderr" | "hook";
  text: string;
}) {
  if (tone === "stderr") {
    return <TerminalOutput text={text} isError />;
  }
  return (
    <div className="rounded-md bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="mr-2 font-medium uppercase tracking-wide text-[10px]">
        {tone === "hook" ? t("chat.view.hook") : t("chat.view.notice")}
      </span>
      <span className="break-words whitespace-pre-wrap">{text}</span>
    </div>
  );
}

function ChatItemRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "message":
      return <MessageItem message={item.message} />;
    case "turn":
      return <TurnRow turn={item.turn} />;
    case "system":
      return <SystemRow tone={item.tone} text={item.text} />;
    case "exit":
      return (
        <div className="mono rounded-md border px-3 py-1.5 text-[11px] text-muted-foreground">
          {t("chat.view.exited")}
          {item.code !== null && ` (${t("chat.view.exitCode")} ${item.code})`}
        </div>
      );
  }
}

function ChatHeader({ job }: { job: JobSummary }) {
  const [stopOpen, setStopOpen] = useState(false);
  const status = statusColor(job.status);

  const stop = async () => {
    try {
      await stopJob(job.job_id);
    } catch (error) {
      toast.error(t("chat.view.stopFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="dash-sticky-glass flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
      <span
        className={cn("size-2 shrink-0 rounded-full", status.dot)}
        aria-hidden
      />
      <span className="min-w-0 truncate text-sm font-medium">
        {job.name || job.cwd}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          status.badge,
        )}
      >
        {job.status}
      </span>
      {job.model && (
        <span className="mono shrink-0 text-[11px] text-muted-foreground">
          {job.model}
        </span>
      )}
      <div className="flex-1" />
      {job.cost_usd !== null && (
        <span
          className="mono shrink-0 text-[11px] text-muted-foreground"
          title={t("chat.view.costReported")}
        >
          {formatCost(job.cost_usd)} · {t("chat.view.costReported")}
        </span>
      )}
      {!isTerminalStatus(job.status) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs text-red-600 dark:text-red-400"
          onClick={() => setStopOpen(true)}
        >
          <CircleStop className="size-3.5" />
          {t("chat.view.stop")}
        </Button>
      )}
      <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.view.stopTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chat.view.stopBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.view.stopCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void stop()}>
              {t("chat.view.stopConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ChatView() {
  // TanStack Virtual returns unmemoizable functions; opt this component out
  // of React Compiler memoization instead of risking stale virtual items.
  "use no memo";
  const { jobId, timeline, attachError } = useLiveChat();
  const { data: jobs } = useJobs();
  const job = jobs?.find((candidate) => candidate.job_id === jobId) ?? null;

  const parentRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const items = timeline.items;
  // eslint-disable-next-line react-hooks/incompatible-library -- covered by "use no memo" above
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  });

  // Follow the live tail unless the user has scrolled up to read history.
  // Keyed on lastSeq, not items.length: streamed deltas grow the open
  // assistant message in place, so the count alone misses most updates.
  const lastSeq = timeline.lastSeq;
  useEffect(() => {
    if (lastSeq >= 0 && items.length > 0 && followRef.current) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    }
  }, [lastSeq, items.length, virtualizer]);

  if (!jobId) return null;
  if (attachError || (jobs && !job)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t("chat.view.notFound")}
      </div>
    );
  }
  if (!job) return null;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader job={job} />
      <div
        ref={parentRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          followRef.current =
            el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("chat.view.waiting")}
          </p>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="absolute top-0 left-0 w-full px-4 py-1.5"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <ChatItemRow item={items[virtualItem.index]} />
              </div>
            ))}
          </div>
        )}
      </div>
      <ChatComposer
        jobId={job.job_id}
        status={job.status}
        cwd={job.cwd}
        completions={timeline.completions}
      />
    </div>
  );
}
