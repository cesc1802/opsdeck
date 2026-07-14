import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { HealthCheck } from "@/lib/bindings";
import {
  launchBackgroundAgent,
  listBackgroundAgents,
  runHealthChecks,
} from "@/lib/ipc";
import { t } from "@/lib/i18n";

export function HealthDashboard() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [agents, setAgents] = useState<unknown[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bgPrompt, setBgPrompt] = useState("");
  const [launching, setLaunching] = useState(false);

  async function handleRun() {
    setRunning(true);
    try {
      setChecks(await runHealthChecks());
    } catch (error) {
      toast.error(t("config.health.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleRefreshAgents() {
    setRefreshing(true);
    try {
      const raw = await listBackgroundAgents();
      const parsed: unknown = JSON.parse(raw);
      setAgents(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (error) {
      toast.error(t("config.bg.listFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLaunch() {
    if (!bgPrompt.trim()) return;
    setLaunching(true);
    try {
      await launchBackgroundAgent(bgPrompt.trim());
      setBgPrompt("");
      toast.success(t("config.bg.launched"));
    } catch (error) {
      toast.error(t("config.bg.launchFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Button size="sm" disabled={running} onClick={() => void handleRun()}>
          {running ? t("config.health.running") : t("config.health.run")}
        </Button>

        {checks === null ? (
          <p className="text-sm text-muted-foreground">
            {t("config.health.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.name} className="dash-panel p-3">
                <Collapsible>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`size-2 shrink-0 rounded-full ${
                        check.ok ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {check.name}
                    </span>
                    <span className="mono text-xs text-muted-foreground">
                      {check.duration_ms}ms
                    </span>
                    {check.detail && (
                      <CollapsibleTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("config.health.raw")}
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                      </CollapsibleTrigger>
                    )}
                  </div>
                  <CollapsibleContent>
                    <pre className="mono mt-2 max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                      {check.detail}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold tracking-tight">
            {t("config.bg.title")}
          </h3>
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void handleRefreshAgents()}
          >
            {t("config.bg.refresh")}
          </Button>
        </div>

        {agents !== null &&
          (agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("config.bg.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {agents.map((agent, index) => (
                <li key={index} className="dash-panel p-3">
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="mono w-full truncate text-left text-xs"
                      >
                        {JSON.stringify(agent)}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mono mt-2 max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                        {JSON.stringify(agent, null, 2)}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              ))}
            </ul>
          ))}

        <div className="flex gap-2">
          <Input
            className="text-base"
            placeholder={t("config.bg.promptPlaceholder")}
            value={bgPrompt}
            onChange={(event) => setBgPrompt(event.target.value)}
          />
          <Button
            size="sm"
            className="shrink-0 self-center"
            disabled={launching || !bgPrompt.trim()}
            onClick={() => void handleLaunch()}
          >
            {launching ? t("config.bg.launching") : t("config.bg.launch")}
          </Button>
        </div>
      </section>
    </div>
  );
}
