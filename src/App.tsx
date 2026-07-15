import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { BarChart3, MessageSquarePlus, Settings } from "lucide-react";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { SelectionProvider, useSelection } from "@/hooks/selection-context";
import { LiveRefreshProvider } from "@/hooks/use-live-refresh";
import { MessageJumpProvider } from "@/hooks/message-jump-context";
import { ProjectSidebar } from "@/features/projects/project-sidebar";
import { SessionList } from "@/features/sessions/session-list";
import { MessageView } from "@/features/messages/message-view";
import { InfoPanel } from "@/features/inspector/info-panel";
import { LiveChatProvider } from "@/features/chat/live-chat-context";
import { ChatView } from "@/features/chat/chat-view";
import { NewChatForm } from "@/features/chat/new-chat-form";
import { RunningJobsList } from "@/features/chat/running-jobs-list";
import { ConfigPanel } from "@/features/config/config-panel";
import { StatsPanel } from "@/features/stats/stats-panel";
import { useStats } from "@/features/stats/use-stats";
import type { ProjectSummary } from "@/lib/bindings";
import { formatCost, formatTokens, totalTokens } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { t } from "@/lib/i18n";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The watcher invalidates on file changes; focus refetches only churn.
      refetchOnWindowFocus: false,
    },
  },
});

function Sidebar() {
  return (
    <div className="flex h-full flex-col">
      <RunningJobsList />
      <div className="min-h-0 flex-1">
        <ProjectSidebar />
      </div>
    </div>
  );
}

function MainPane() {
  const { mode, openChat } = useSelection();

  if (mode.kind === "new-chat") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <NewChatForm
            initial={mode.initial}
            onCreated={(job) => openChat(job.job_id)}
          />
        </div>
      </div>
    );
  }
  if (mode.kind === "chat") {
    return <ChatView />;
  }
  if (mode.kind === "config") {
    return <ConfigPanel />;
  }
  if (mode.kind === "stats") {
    return <StatsPanel />;
  }
  return (
    <div className="flex h-full">
      <div className="w-[320px] shrink-0 overflow-hidden border-r">
        <SessionList />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <MessageView />
      </div>
    </div>
  );
}

function StatsButton() {
  const { openStats } = useSelection();
  const { data: stats } = useStats();

  let chip: string | null = null;
  if (stats && stats.totals.session_count > 0) {
    const tokens = formatTokens(totalTokens(stats.totals.tokens));
    const cost = formatCost(stats.totals.estimated_cost_usd);
    chip = `${tokens} ${t("stats.chip.tokens")} · ${cost.startsWith("<") ? cost : `~${cost}`}`;
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-2.5 text-xs"
      onClick={() => openStats()}
      title={t("stats.title")}
    >
      <BarChart3 className="size-3.5" />
      {chip ? (
        <span className="mono tabular-nums">{chip}</span>
      ) : (
        t("shell.stats")
      )}
    </Button>
  );
}

function ConfigButton() {
  const { openConfig } = useSelection();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-2.5 text-xs"
      onClick={() => openConfig()}
    >
      <Settings className="size-3.5" />
      {t("shell.config")}
    </Button>
  );
}

function NewChatButton() {
  const { openNewChat, projectId } = useSelection();
  const queryClient = useQueryClient();
  return (
    <Button
      size="sm"
      className="h-7 gap-1.5 px-2.5 text-xs"
      onClick={() => {
        // Seed the form with the sidebar-selected project's cwd, read from
        // the projects query cache the sidebar keeps warm.
        const projects = queryClient.getQueryData<ProjectSummary[]>(
          queryKeys.projects,
        );
        const cwd = projects?.find(
          (project) => project.project_id === projectId,
        )?.cwd;
        openNewChat(cwd ? { cwd } : undefined);
      }}
    >
      <MessageSquarePlus className="size-3.5" />
      {t("shell.newChat")}
    </Button>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SelectionProvider>
            <LiveChatProvider>
              <LiveRefreshProvider>
                <MessageJumpProvider>
                  <AppShell
                    sidebar={<Sidebar />}
                    main={<MainPane />}
                    infoPanel={<InfoPanel />}
                    headerActions={
                      <>
                        <StatsButton />
                        <ConfigButton />
                        <NewChatButton />
                      </>
                    }
                  />
                  <Toaster />
                </MessageJumpProvider>
              </LiveRefreshProvider>
            </LiveChatProvider>
          </SelectionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
