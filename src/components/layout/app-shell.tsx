import { type ReactNode } from "react";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { t } from "@/lib/i18n";

interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
  infoPanel: ReactNode;
  headerActions?: ReactNode;
}

export function AppShell({
  sidebar,
  main,
  infoPanel,
  headerActions,
}: AppShellProps) {
  const [infoPanelOpen, setInfoPanelOpen] = useLocalStorage(
    "opsdeck.infoPanelOpen",
    true,
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-sm font-semibold tracking-tight">
          {t("app.name")}
        </span>
        <div className="flex-1" />
        {headerActions}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("shell.infoPanel.toggle")}
          title={t("shell.infoPanel.toggle")}
          onClick={() => setInfoPanelOpen(!infoPanelOpen)}
        >
          <PanelRight className="size-4" />
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <ThemeToggle />
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[280px] shrink-0 overflow-hidden border-r">
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">{main}</main>
        {infoPanelOpen && (
          <aside className="w-[360px] shrink-0 overflow-hidden border-l">
            {infoPanel}
          </aside>
        )}
      </div>
    </div>
  );
}
