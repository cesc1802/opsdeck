import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

import { t } from "@/lib/i18n";

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-md border border-dashed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? t("thinking.hide") : t("thinking.show")}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      >
        <Chevron className="size-3.5 shrink-0" />
        <Brain className="size-3.5 shrink-0" />
        <span>{t("thinking.label")}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 text-xs whitespace-pre-wrap break-words text-muted-foreground italic">
          {thinking}
        </div>
      )}
    </div>
  );
}
