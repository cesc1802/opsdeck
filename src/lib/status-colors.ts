// Status color conventions from the dash design system: *-500 solid dots,
// *-400 dark-theme text, light tints for badges. Shared by job states
// (running/completed/error) and health checks (ok/warn/fail).
export type StatusTone = "success" | "error" | "warning" | "info" | "running" | "neutral";

interface StatusClasses {
  dot: string;
  text: string;
  badge: string;
}

const TONE_CLASSES: Record<StatusTone, StatusClasses> = {
  success: {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    badge:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30",
  },
  error: {
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    badge:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    badge:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30",
  },
  info: {
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    badge:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30",
  },
  running: {
    dot: "bg-orange-500",
    text: "text-orange-600 dark:text-orange-400",
    badge:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/30",
  },
  neutral: {
    dot: "bg-dash-text-muted",
    text: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground border-border",
  },
};

const STATUS_TONES: Record<string, StatusTone> = {
  running: "running",
  starting: "running",
  completed: "success",
  ok: "success",
  passed: "success",
  error: "error",
  failed: "error",
  killed: "error",
  interrupted: "warning",
  warn: "warning",
  warning: "warning",
  pending: "neutral",
  idle: "neutral",
  queued: "info",
};

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status.toLowerCase()] ?? "neutral";
}

export function statusColor(status: string): StatusClasses {
  return TONE_CLASSES[statusTone(status)];
}
