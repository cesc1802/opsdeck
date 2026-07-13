import { Copy } from "lucide-react";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { useMessageJump } from "@/hooks/message-jump-context";
import { TerminalOutput } from "@/features/messages/blocks/terminal-output";
import type { ChangeEntry } from "../lib/derive";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("message.copied"));
  } catch {
    toast.error(t("message.copyFailed"));
  }
}

function ChangeSide({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copyText(content)}
          title={t("message.copy")}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent"
        >
          <Copy className="size-3" />
        </button>
      </div>
      <TerminalOutput text={content} />
    </div>
  );
}

export function ChangesTab({ changes }: { changes: ChangeEntry[] }) {
  const { jumpTo } = useMessageJump();

  if (changes.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        {t("inspector.changes.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {changes.map((change, i) => {
        const basename = change.path.split("/").pop() ?? change.path;
        return (
          <div key={i} className="space-y-1.5 rounded-md border p-2">
            <button
              type="button"
              onClick={() => jumpTo(change.msgIndex)}
              title={`${change.path} — ${t("inspector.jump")}`}
              className="flex w-full items-center gap-1.5 text-left text-xs hover:underline"
            >
              <span className="font-medium">{change.tool}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {basename}
              </span>
            </button>
            {change.before !== null && (
              <ChangeSide label={t("inspector.changes.before")} content={change.before} />
            )}
            {change.after !== null && (
              <ChangeSide label={t("inspector.changes.after")} content={change.after} />
            )}
          </div>
        );
      })}
    </div>
  );
}
