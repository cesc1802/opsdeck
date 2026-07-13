import { useState } from "react";
import { stripAnsi } from "@/lib/ansi";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Long tool outputs (build logs, file dumps) are clamped so a single result
// cannot dominate the virtualized list; the user can expand in place.
const CLAMP_CHARS = 4000;

interface TerminalOutputProps {
  text: string;
  isError?: boolean;
}

export function TerminalOutput({ text, isError = false }: TerminalOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const clean = stripAnsi(text);
  const clamped = !expanded && clean.length > CLAMP_CHARS;
  const shown = clamped ? clean.slice(0, CLAMP_CHARS) : clean;

  return (
    <div>
      <pre
        className={cn(
          "overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words",
          isError && "bg-destructive/10 text-destructive",
        )}
      >
        {shown}
        {clamped && "…"}
      </pre>
      {clean.length > CLAMP_CHARS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-primary hover:underline"
        >
          {expanded ? t("tool.showLess") : t("tool.showMore")}
        </button>
      )}
    </div>
  );
}
