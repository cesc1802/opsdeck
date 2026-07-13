import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/app-shell";
import { SelectionProvider } from "@/hooks/selection-context";
import { LiveRefreshProvider } from "@/hooks/use-live-refresh";
import { MessageJumpProvider } from "@/hooks/message-jump-context";
import { ProjectSidebar } from "@/features/projects/project-sidebar";
import { SessionList } from "@/features/sessions/session-list";
import { MessageView } from "@/features/messages/message-view";
import { InfoPanel } from "@/features/inspector/info-panel";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The watcher invalidates on file changes; focus refetches only churn.
      refetchOnWindowFocus: false,
    },
  },
});

function MainPane() {
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SelectionProvider>
            <LiveRefreshProvider>
              <MessageJumpProvider>
                <AppShell
                  sidebar={<ProjectSidebar />}
                  main={<MainPane />}
                  infoPanel={<InfoPanel />}
                />
                <Toaster />
              </MessageJumpProvider>
            </LiveRefreshProvider>
          </SelectionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
