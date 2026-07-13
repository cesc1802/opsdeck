import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Radio, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSession } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { useSelection } from "@/hooks/selection-context";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { useMessageJump } from "@/hooks/message-jump-context";
import { cn } from "@/lib/utils";
import { FindBar } from "./find-bar";
import { MessageItem } from "./message-item";
import { useFindInSession } from "./use-find-in-session";

export function MessageView() {
  // TanStack Virtual returns unmemoizable functions; opt this component out
  // of React Compiler memoization instead of risking stale virtual items.
  "use no memo";
  const { projectId, sessionId } = useSelection();
  const { live, setLive, syncNow } = useLiveRefresh();

  const enabled = projectId !== null && sessionId !== null;
  const { data: detail, isPending, isError } = useQuery({
    queryKey: queryKeys.session(projectId ?? "", sessionId ?? ""),
    queryFn: () => fetchSession(projectId!, sessionId!),
    enabled,
  });

  const messages = detail?.messages;
  const find = useFindInSession(messages);

  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- covered by "use no memo" above
  const virtualizer = useVirtualizer({
    count: messages?.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160,
    overscan: 8,
  });

  useEffect(() => {
    if (find.activeMessageIndex !== null) {
      virtualizer.scrollToIndex(find.activeMessageIndex, { align: "center" });
    }
  }, [find.activeMessageIndex, virtualizer]);

  // Inspector jump links: scroll to the message and flash it briefly.
  const { setHandler } = useMessageJump();
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  useEffect(() => {
    setHandler((index) => {
      virtualizer.scrollToIndex(index, { align: "center" });
      setFlashIndex(index);
    });
    return () => setHandler(null);
  }, [setHandler, virtualizer]);
  useEffect(() => {
    if (flashIndex === null) return;
    const timer = setTimeout(() => setFlashIndex(null), 1600);
    return () => clearTimeout(timer);
  }, [flashIndex]);

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {t("shell.main.placeholder")}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        {detail && (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {detail.meta.preview || detail.meta.session_id}
          </span>
        )}
        {detail && detail.malformed_lines > 0 && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title={`${detail.malformed_lines} ${t("messages.malformedNotice")}`}
          >
            <TriangleAlert className="size-3.5" />
            {detail.malformed_lines}
          </span>
        )}
        <Button
          variant={live ? "secondary" : "ghost"}
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => setLive(!live)}
          title={live ? t("live.pause") : t("live.resume")}
        >
          <Radio className={cn("size-3.5", live && "text-emerald-500")} />
          {t("live.label")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          onClick={syncNow}
          title={t("sync.tooltip")}
        >
          <RefreshCw className="size-3.5" />
          {t("sync.label")}
        </Button>
      </div>

      <FindBar find={find} />

      {isPending && (
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
      {isError && (
        <p className="p-4 text-sm text-destructive">{t("messages.error")}</p>
      )}
      {messages && messages.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">
          {t("messages.empty")}
        </p>
      )}

      {messages && messages.length > 0 && (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute top-0 left-0 w-full px-4 py-1.5"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <MessageItem
                  message={messages[item.index]}
                  highlighted={
                    item.index === find.activeMessageIndex ||
                    item.index === flashIndex
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
