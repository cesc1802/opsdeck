import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { JsonValue, ToolResultInfo } from "@/lib/bindings";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toolMeta } from "../tool-meta";
import { TerminalOutput } from "./terminal-output";

interface ToolUseCardProps {
  name: string;
  input: JsonValue;
  result: ToolResultInfo | null;
}

export function ToolUseCard({ name, input, result }: ToolUseCardProps) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, target } = toolMeta(name);
  const targetText = target(input);
  const Chevron = open ? ChevronDown : ChevronRight;
  const isError = result?.is_error ?? false;

  return (
    <div className={cn("rounded-md border", isError && "border-destructive/50")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-accent"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{name}</span>
        {targetText && (
          <span className="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground">
            {targetText}
          </span>
        )}
        {isError && (
          <span className="ml-auto shrink-0 text-destructive">
            {t("tool.error")}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t px-2 py-2">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("tool.input")}
            </div>
            <TerminalOutput text={JSON.stringify(input, null, 2)} />
          </div>
          {result && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {isError ? t("tool.error") : t("tool.result")}
              </div>
              <TerminalOutput text={result.content} isError={isError} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
