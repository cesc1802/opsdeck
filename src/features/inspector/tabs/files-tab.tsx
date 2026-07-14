import { useState } from "react";
import { File, FileCode, FileJson, FileText } from "lucide-react";
import { t, type I18nKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMessageJump } from "@/hooks/message-jump-context";
import type { FileArtifact, FileAction } from "../lib/derive";

const FOLD_COUNT = 15;

type Filter = "all" | FileAction;

const FILTERS: { value: Filter; labelKey: I18nKey }[] = [
  { value: "all", labelKey: "inspector.files.filter.all" },
  { value: "read", labelKey: "inspector.files.filter.read" },
  { value: "create", labelKey: "inspector.files.filter.create" },
  { value: "edit", labelKey: "inspector.files.filter.edit" },
];

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "kt", "swift", "c",
  "cpp", "h", "rb", "sh", "css", "html", "vue", "svelte",
]);

function fileIcon(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (ext === "json" || ext === "jsonl") return FileJson;
  if (ext === "md" || ext === "txt") return FileText;
  return File;
}

export function FilesTab({ files }: { files: FileArtifact[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const { jumpTo } = useMessageJump();

  const filtered =
    filter === "all" ? files : files.filter((f) => f.actions.includes(filter));
  const visible = showAll ? filtered : filtered.slice(0, FOLD_COUNT);

  if (files.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        {t("inspector.files.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs hover:bg-accent",
              value === filter
                ? "bg-primary text-primary-foreground hover:bg-primary"
                : "text-muted-foreground",
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className="space-y-0.5">
        {visible.map((file) => {
          const Icon = fileIcon(file.path);
          const basename = file.path.split("/").pop() ?? file.path;
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => jumpTo(file.lastMsgIndex)}
              title={`${file.path} — ${t("inspector.jump")}`}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="mono min-w-0 flex-1 truncate">{basename}</span>
              {file.added > 0 && (
                <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-500">
                  +{file.added}
                </span>
              )}
              {file.removed > 0 && (
                <span className="shrink-0 tabular-nums text-red-600 dark:text-red-500">
                  −{file.removed}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {filtered.length > FOLD_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {showAll
            ? t("inspector.files.showLess")
            : `${t("inspector.files.showMore")} (${filtered.length})`}
        </button>
      )}
    </div>
  );
}
