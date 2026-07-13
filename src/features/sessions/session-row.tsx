import { Coins, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SessionMeta } from "@/lib/bindings";
import { formatCost, formatTokens, relativeTime, totalTokens } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function shortModel(model: string): string {
  for (const family of ["opus", "sonnet", "haiku"]) {
    if (model.includes(family)) return family;
  }
  return model;
}

interface SessionRowProps {
  session: SessionMeta;
  selected: boolean;
  onSelect: () => void;
}

export function SessionRow({ session, selected, onSelect }: SessionRowProps) {
  const tokens = totalTokens(session.tokens);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <div className="flex items-center gap-2">
        {session.is_active && (
          <span
            className="size-2 shrink-0 rounded-full bg-emerald-500"
            title={t("sessions.active")}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">
          {session.preview || session.session_id}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">
          {relativeTime(session.ended_at ?? session.started_at)}
        </span>
        {tokens > 0 && (
          <span className="shrink-0 tabular-nums">
            {formatTokens(tokens)} {t("message.tokens")}
          </span>
        )}
        {session.estimated_cost_usd > 0 && (
          <span
            className="flex shrink-0 items-center gap-0.5 tabular-nums"
            title={t("cost.estimated")}
          >
            <Coins className="size-3" />
            {formatCost(session.estimated_cost_usd)}
          </span>
        )}
        {session.models[0] && (
          <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
            {shortModel(session.models[0])}
          </Badge>
        )}
        {session.git_branch && (
          <span className="flex min-w-0 items-center gap-0.5 truncate">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{session.git_branch}</span>
          </span>
        )}
      </div>
    </button>
  );
}
