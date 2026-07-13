import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchPricing, fetchSession } from "@/lib/ipc";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";
import { useSelection } from "@/hooks/selection-context";
import { deriveInspector } from "./lib/derive";
import { OverviewStrip } from "./overview-strip";
import { TokenGrid } from "./token-grid";
import { FilesTab } from "./tabs/files-tab";
import { ChangesTab } from "./tabs/changes-tab";
import { AuditTab } from "./tabs/audit-tab";
import { TasksSection } from "./tabs/tasks-section";

export function InfoPanel() {
  const { projectId, sessionId } = useSelection();
  const enabled = projectId !== null && sessionId !== null;

  // Same query key as the message view — served from cache, no second parse.
  const { data: detail } = useQuery({
    queryKey: queryKeys.session(projectId ?? "", sessionId ?? ""),
    queryFn: () => fetchSession(projectId!, sessionId!),
    enabled,
  });
  const { data: pricing } = useQuery({
    queryKey: queryKeys.pricing,
    queryFn: fetchPricing,
    staleTime: Infinity,
  });

  const data = useMemo(
    () => (detail ? deriveInspector(detail.messages, pricing) : null),
    [detail, pricing],
  );

  if (!detail || !data) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
        {t("inspector.empty")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="space-y-3">
        <OverviewStrip meta={detail.meta} toolCounts={data.toolCounts} />
        <TokenGrid tokens={data.tokens} cost={data.cost} />
        <TasksSection tasks={data.tasks} />
        <Separator />
      </div>
      <Tabs defaultValue="files" className="mt-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="files">{t("inspector.tab.files")}</TabsTrigger>
          <TabsTrigger value="changes">{t("inspector.tab.changes")}</TabsTrigger>
          <TabsTrigger value="audit">{t("inspector.tab.audit")}</TabsTrigger>
        </TabsList>
        <TabsContent value="files">
          <FilesTab files={data.files} />
        </TabsContent>
        <TabsContent value="changes">
          <ChangesTab changes={data.changes} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab audit={data.audit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
