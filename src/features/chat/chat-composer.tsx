import { useState } from "react";
import { toast } from "sonner";
import { CircleStop, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { JobStatus } from "@/lib/bindings";
import { interruptJob, sendUserMessage } from "@/lib/ipc";
import { t } from "@/lib/i18n";
import { composerAction } from "./job-display";

interface ChatComposerProps {
  jobId: string;
  status: JobStatus;
}

/**
 * Follow-up input: sends when the job is idle, interrupts the current turn
 * while it is running, and is disabled while starting or after the job ends.
 */
export function ChatComposer({ jobId, status }: ChatComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const action = composerAction(status);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy || action !== "send") return;
    setBusy(true);
    try {
      await sendUserMessage(jobId, trimmed);
      setText("");
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

  if (action === "ended") {
    return (
      <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
        {t("chat.composer.ended")}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        placeholder={
          action === "starting"
            ? t("chat.composer.starting")
            : t("chat.composer.placeholder")
        }
        disabled={action === "starting"}
        rows={2}
        className="max-h-40 min-h-9 flex-1 resize-none"
      />
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
