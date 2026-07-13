import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import type { FindInSession } from "./use-find-in-session";

export function FindBar({ find }: { find: FindInSession }) {
  if (!find.open) return null;

  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-md border bg-background p-1 shadow-md">
      <Input
        autoFocus
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) find.previous();
            else find.next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            find.close();
          }
        }}
        placeholder={t("find.placeholder")}
        className="h-7 w-52 text-sm"
      />
      <span className="min-w-12 px-1 text-center text-xs tabular-nums text-muted-foreground">
        {find.query.trim() === ""
          ? ""
          : find.matches.length === 0
            ? t("find.noMatches")
            : `${find.active + 1}/${find.matches.length}`}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={find.previous}
        disabled={find.matches.length === 0}
        title={t("find.previous")}
      >
        <ChevronUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={find.next}
        disabled={find.matches.length === 0}
        title={t("find.next")}
      >
        <ChevronDown className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={find.close}
        title={t("find.close")}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
