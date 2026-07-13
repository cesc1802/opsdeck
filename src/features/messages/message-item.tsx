import { Bot, Copy, User } from "lucide-react";
import { toast } from "sonner";
import type { Message } from "@/lib/bindings";
import { parseUserText } from "@/lib/command-tags";
import { formatClockTime, formatTokens, totalTokens } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { extractMessageText } from "./message-text";
import { CommandChip } from "./blocks/command-chip";
import { MarkdownBlock } from "./blocks/markdown-block";
import { TerminalOutput } from "./blocks/terminal-output";
import { ThinkingBlock } from "./blocks/thinking-block";
import { ToolUseCard } from "./blocks/tool-use-card";

function UserText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseUserText(text).map((segment, i) => {
        switch (segment.kind) {
          case "command":
            return <CommandChip key={i} name={segment.name} args={segment.args} />;
          case "stdout":
            return <TerminalOutput key={i} text={segment.text} />;
          case "text":
            return <MarkdownBlock key={i} text={segment.text} />;
        }
      })}
    </div>
  );
}

async function copyMessage(message: Message) {
  try {
    await navigator.clipboard.writeText(extractMessageText(message));
    toast.success(t("message.copied"));
  } catch {
    toast.error(t("message.copyFailed"));
  }
}

interface MessageItemProps {
  message: Message;
  highlighted?: boolean;
}

export function MessageItem({ message, highlighted = false }: MessageItemProps) {
  const isUser = message.role === "user";
  const RoleIcon = isUser ? User : Bot;
  const tokens = message.usage ? totalTokens(message.usage) : 0;

  return (
    <div
      className={cn(
        "group rounded-lg border p-3",
        isUser ? "bg-accent/40" : "bg-background",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <RoleIcon className="size-3.5 shrink-0" />
        <span className="font-medium">
          {isUser ? t("message.role.user") : t("message.role.assistant")}
        </span>
        {message.model && <span className="truncate">{message.model}</span>}
        {message.timestamp && (
          <span className="shrink-0">{formatClockTime(message.timestamp)}</span>
        )}
        {tokens > 0 && (
          <span className="shrink-0 tabular-nums">
            {formatTokens(tokens)} {t("message.tokens")}
          </span>
        )}
        <button
          type="button"
          onClick={() => void copyMessage(message)}
          title={t("message.copy")}
          className="ml-auto shrink-0 rounded p-1 opacity-0 hover:bg-accent group-hover:opacity-100"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
      <div className="space-y-2">
        {message.blocks.map((block, i) => {
          switch (block.type) {
            case "text":
              return isUser ? (
                <UserText key={i} text={block.text} />
              ) : (
                <MarkdownBlock key={i} text={block.text} />
              );
            case "thinking":
              return <ThinkingBlock key={i} thinking={block.thinking} />;
            case "tool_use":
              return (
                <ToolUseCard
                  key={block.id || i}
                  name={block.name}
                  input={block.input}
                  result={block.result}
                />
              );
            case "tool_result":
              return (
                <div key={i}>
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("tool.unpairedResult")}
                  </div>
                  <TerminalOutput text={block.content} isError={block.is_error} />
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}
