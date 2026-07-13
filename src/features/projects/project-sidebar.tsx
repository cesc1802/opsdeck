import { useQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchProjects } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { useSelection } from "@/hooks/selection-context";
import { cn } from "@/lib/utils";

export function ProjectSidebar() {
  const { projectId, selectProject } = useSelection();
  const { data: projects, isPending, isError } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: fetchProjects,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("projects.title")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isPending && (
          <div className="space-y-2 px-1 pt-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {isError && (
          <p className="px-2 pt-2 text-sm text-destructive">
            {t("projects.error")}
          </p>
        )}
        {projects && projects.length === 0 && (
          <div className="px-2 pt-4 text-sm text-muted-foreground">
            <p>{t("projects.empty")}</p>
            <p className="mt-1 text-xs">{t("projects.emptyHint")}</p>
          </div>
        )}
        {projects?.map((project) => (
          <button
            key={project.project_id}
            type="button"
            onClick={() => selectProject(project.project_id)}
            title={project.path}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
              project.project_id === projectId && "bg-accent",
            )}
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.active_count > 0 && (
              <span
                className="size-2 shrink-0 rounded-full bg-emerald-500"
                title={t("sessions.active")}
              />
            )}
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {project.session_count}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
