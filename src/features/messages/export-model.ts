import type { ExportFormat } from "@/lib/bindings";

export interface ExportPlan {
  format: ExportFormat;
  redact: boolean;
  filename: string;
  /** Human label for the OS save-dialog filter. */
  filterName: string;
}

export const EXPORT_FORMATS: ExportFormat[] = ["md", "json", "html"];

const FILTER_NAMES: Record<ExportFormat, string> = {
  md: "Markdown",
  json: "JSON",
  html: "HTML",
};

export function exportPlan(
  sessionId: string,
  format: ExportFormat,
  redact: boolean,
): ExportPlan {
  return {
    format,
    redact,
    filename: `${sessionId}.${format}`,
    filterName: FILTER_NAMES[format],
  };
}

/** Share is always a redacted HTML file — never an unredacted variant. */
export function sharePlan(sessionId: string): ExportPlan {
  return exportPlan(sessionId, "html", true);
}
