import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleStop, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { JobStatus } from "@/lib/bindings";
import { fetchCompletions, interruptJob, sendUserMessage } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { composerAction } from "./job-display";
import type { ChatTimeline } from "./chat-timeline-reducer";
import {
  activeSlashToken,
  applyCompletion,
  filterCompletions,
  mergeCatalogs,
} from "./slash-completion";

/** Rows shown in the completion popup; the query narrows the rest. */
const MAX_VISIBLE = 8;

interface ChatComposerProps {
  jobId: string;
  status: JobStatus;
  cwd: string;
  completions: ChatTimeline["completions"];
}

/**
 * Follow-up input: sends when the job is idle or starting (a promptless
 * launch waits here for its first message), interrupts the current turn while
 * it is running, and is disabled after the job ends. Typing a `/token` opens
 * a completion popup over commands, skills, and agents.
 */
export function ChatComposer({
  jobId,
  status,
  cwd,
  completions,
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const action = composerAction(status);

  // Filesystem scan: instant completions before the session init event.
  const { data: scanned } = useQuery({
    queryKey: queryKeys.completions(cwd),
    queryFn: () => fetchCompletions(cwd),
  });
  const catalog = useMemo(
    () => mergeCatalogs(scanned, completions),
    [scanned, completions],
  );

  const token = activeSlashToken(text, caret);
  const matches =
    token && !dismissed ? filterCompletions(catalog, token.query) : [];
  const visible = matches.slice(0, MAX_VISIBLE);
  const open = visible.length > 0;
  const highlighted = Math.min(selected, visible.length - 1);

  const insert = (name: string) => {
    if (!token) return;
    const next = applyCompletion(text, token, name);
    setText(next.text);
    setCaret(next.caret);
    setSelected(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  };

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy || action !== "send") return;
    setBusy(true);
    try {
      await sendUserMessage(jobId, trimmed);
      setText("");
      setCaret(0);
    } catch (error) {
      toast.error(t("chat.composer.sendFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await interruptJob(jobId);
    } catch (error) {
      toast.error(t("chat.composer.interruptFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter that commits an IME composition must neither select nor send.
    if (event.nativeEvent.isComposing) return;
    if (open) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelected((highlighted + 1) % visible.length);
          return;
        case "ArrowUp":
          event.preventDefault();
          setSelected((highlighted - 1 + visible.length) % visible.length);
          return;
        case "Enter":
        case "Tab":
          event.preventDefault();
          insert(visible[highlighted].name);
          return;
        case "Escape":
          event.preventDefault();
          setDismissed(true);
          return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (action === "ended") {
    return (
      <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
        {t("chat.composer.ended")}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <div className="relative flex-1">
        {open && (
          <ul
            id="slash-completion-list"
            role="listbox"
            className="absolute bottom-full left-0 z-10 mb-1 w-full overflow-hidden rounded-md border bg-popover py-1 shadow-md"
          >
            {visible.map((item, index) => (
              <li
                key={item.name}
                id={`slash-completion-option-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm",
                  index === highlighted && "bg-accent text-accent-foreground",
                )}
                // mousedown so the textarea never loses focus on click
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(item.name);
                }}
                onMouseEnter={() => setSelected(index)}
              >
                <span className="mono truncate">/{item.name}</span>
                <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {item.kind === "agent"
                    ? t("chat.completion.agent")
                    : t("chat.completion.command")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          ref={textareaRef}
          value={text}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? "slash-completion-list" : undefined}
          aria-activedescendant={
            open ? `slash-completion-option-${highlighted}` : undefined
          }
          aria-autocomplete="list"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
            setDismissed(false);
            setSelected(0);
          }}
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart)
          }
          onKeyDown={onKeyDown}
          placeholder={
            status === "starting"
              ? t("chat.composer.firstMessage")
              : t("chat.composer.placeholder")
          }
          rows={2}
          className="max-h-40 min-h-9 w-full resize-none"
        />
      </div>
      {action === "interrupt" ? (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => void interrupt()}
          disabled={busy}
        >
          <CircleStop className="size-4" />
          {t("chat.composer.interrupt")}
        </Button>
      ) : (
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => void send()}
          disabled={action !== "send" || busy || !text.trim()}
        >
          <SendHorizontal className="size-4" />
          {t("chat.composer.send")}
        </Button>
      )}
    </div>
  );
}
