import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { exportSession, writeExport } from "@/lib/ipc";
import { t, type I18nKey } from "@/lib/i18n";
import {
  exportPlan,
  sharePlan,
  EXPORT_FORMATS,
  type ExportPlan,
} from "./export-model";

const FORMAT_LABELS: Record<string, { label: I18nKey; desc: I18nKey }> = {
  md: { label: "export.format.md", desc: "export.format.md.desc" },
  json: { label: "export.format.json", desc: "export.format.json.desc" },
  html: { label: "export.format.html", desc: "export.format.html.desc" },
};

export function ExportMenu({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [redact, setRedact] = useState(true);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function run(plan: ExportPlan) {
    setBusy(true);
    try {
      const content = await exportSession(
        projectId,
        sessionId,
        plan.format,
        plan.redact,
      );
      const path = await save({
        defaultPath: plan.filename,
        filters: [{ name: plan.filterName, extensions: [plan.format] }],
      });
      if (!path) return;
      await writeExport(path, content);
      toast.success(t("export.done"));
      setOpen(false);
    } catch (error) {
      toast.error(t("export.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => setOpen((prev) => !prev)}
        title={t("export.tooltip")}
      >
        <Download className="size-3.5" />
        {t("export.button")}
      </Button>
      {open && (
        <div className="dash-panel absolute right-0 top-8 z-20 w-64 p-1.5 shadow-md">
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              disabled={busy}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-dash-surface-hover disabled:opacity-50"
              onClick={() => void run(exportPlan(sessionId, format, redact))}
            >
              <div className="font-medium">{t(FORMAT_LABELS[format].label)}</div>
              <div className="text-muted-foreground">
                {t(FORMAT_LABELS[format].desc)}
              </div>
            </button>
          ))}
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-dash-surface-hover">
            <input
              type="checkbox"
              className="accent-dash-accent"
              checked={redact}
              onChange={(event) => setRedact(event.target.checked)}
            />
            {t("export.redact")}
          </label>
          <Separator className="my-1" />
          <button
            type="button"
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md bg-dash-accent-subtle px-2 py-1.5 text-left text-xs font-medium text-dash-accent hover:bg-dash-accent-selection disabled:opacity-50"
            onClick={() => void run(sharePlan(sessionId))}
          >
            <Share2 className="size-3.5" />
            <span>
              {t("export.share")}
              <span className="block font-normal text-muted-foreground">
                {t("export.share.desc")}
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
