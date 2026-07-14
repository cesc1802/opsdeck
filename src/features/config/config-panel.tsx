import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/lib/i18n";
import { AgentBuilderTab } from "./agent-builder";
import { HealthDashboard } from "./health-dashboard";
import { HookBuilderTab } from "./hook-builder";
import { ProfilesTab } from "./profile-list";

export function ConfigPanel() {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("config.title")}
        </h2>
        <Tabs defaultValue="profiles">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profiles">
              {t("config.tab.profiles")}
            </TabsTrigger>
            <TabsTrigger value="agents">{t("config.tab.agents")}</TabsTrigger>
            <TabsTrigger value="hooks">{t("config.tab.hooks")}</TabsTrigger>
            <TabsTrigger value="health">{t("config.tab.health")}</TabsTrigger>
          </TabsList>
          <TabsContent value="profiles" className="mt-3">
            <ProfilesTab />
          </TabsContent>
          <TabsContent value="agents" className="mt-3">
            <AgentBuilderTab />
          </TabsContent>
          <TabsContent value="hooks" className="mt-3">
            <HookBuilderTab />
          </TabsContent>
          <TabsContent value="health" className="mt-3">
            <HealthDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
