import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { formatClockTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useMessageJump } from "@/hooks/message-jump-context";
import type { AuditEntry, AuditStatus } from "../lib/derive";

const STATUS_ICONS: Record<
  AuditStatus,
  { icon: typeof CircleCheck; className: string }
> = {
  ok: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-500" },
  error: { icon: CircleX, className: "text-destructive" },
  pending: { icon: CircleDashed, className: "text-muted-foreground" },
};

export function AuditTab({ audit }: { audit: AuditEntry[] }) {
  const { jumpTo } = useMessageJump();

  if (audit.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        {t("inspector.audit.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {audit.map((entry, i) => {
        const { icon: Icon, className } = STATUS_ICONS[entry.status];
        return (
          <button
            key={i}
            type="button"
            onClick={() => jumpTo(entry.msgIndex)}
            title={entry.target ? `${entry.target} — ${t("inspector.jump")}` : t("inspector.jump")}
            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
          >
            <Icon className={`size-3.5 shrink-0 ${className}`} />
            <span className="shrink-0 font-medium">{entry.tool}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
              {entry.target ?? ""}
            </span>
            {entry.timestamp && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatClockTime(entry.timestamp)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
