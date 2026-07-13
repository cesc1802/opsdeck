import { CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import { t } from "@/lib/i18n";
import type { TaskEntry } from "../lib/derive";

function statusIcon(status: string) {
  if (status === "completed") {
    return { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-500" };
  }
  if (status === "in_progress") {
    return { icon: LoaderCircle, className: "text-sky-600 dark:text-sky-500" };
  }
  return { icon: CircleDashed, className: "text-muted-foreground" };
}

export function TasksSection({ tasks }: { tasks: TaskEntry[] }) {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("inspector.tasks.title")}
      </div>
      {tasks.map((task, i) => {
        const { icon: Icon, className } = statusIcon(task.status);
        return (
          <div key={task.id ?? `anon-${i}`} className="flex items-center gap-1.5 text-xs">
            <Icon className={`size-3.5 shrink-0 ${className}`} />
            <span className="min-w-0 flex-1 truncate" title={task.subject}>
              {task.subject}
            </span>
            {task.id && (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                #{task.id}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
