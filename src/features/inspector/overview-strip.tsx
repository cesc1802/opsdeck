import { Badge } from "@/components/ui/badge";
import type { SessionMeta } from "@/lib/bindings";
import { t, type I18nKey } from "@/lib/i18n";
import { toolMeta } from "@/features/messages/tool-meta";

function ContextRow({ labelKey, value }: { labelKey: I18nKey; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{t(labelKey)}</span>
      <span className="mono min-w-0 truncate text-right font-medium" title={value}>
        {value}
      </span>
    </div>
  );
}

export function OverviewStrip({
  meta,
  toolCounts,
}: {
  meta: SessionMeta;
  toolCounts: Record<string, number>;
}) {
  const badges = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {meta.cwd && <ContextRow labelKey="inspector.context.cwd" value={meta.cwd} />}
        {meta.git_branch && (
          <ContextRow labelKey="inspector.context.branch" value={meta.git_branch} />
        )}
        {meta.models.length > 0 && (
          <ContextRow
            labelKey="inspector.context.models"
            value={meta.models.join(", ")}
          />
        )}
        {meta.cli_version && (
          <ContextRow labelKey="inspector.context.cliVersion" value={meta.cli_version} />
        )}
        <ContextRow
          labelKey="inspector.context.messages"
          value={String(meta.message_count)}
        />
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {badges.map(([name, count]) => {
            const { icon: Icon } = toolMeta(name);
            return (
              <Badge key={name} variant="secondary" className="gap-1 px-1.5 text-[10px]">
                <Icon className="size-3" />
                {name}
                <span className="tabular-nums">{count}</span>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
