// Pure helpers for the New Chat project picker: which picker entry is active
// for a given cwd, and the entry list the Select renders. Picker state is
// derived from `options.cwd` (single source of truth), never stored. Kept
// free of React so the matching logic is unit-testable.
import type { ProjectSummary } from "@/lib/bindings";

/** Select sentinel for the "Custom path…" entry; never a real path. */
export const CUSTOM_CWD = "custom";

/** One row in the picker Select. The custom entry is appended by the form
 * (its label is i18n), so entries here always carry a project. */
export interface PickerEntry {
  projectId: string;
  name: string;
  cwd: string | null;
  /** Projects whose cwd could not be read from session JSONL are shown but
   * not selectable — there is no path to hand to the launcher. */
  disabled: boolean;
}

/** Exact-match normalization only: trailing slashes trimmed, nothing fuzzy.
 * A session run in a subdirectory intentionally falls to "Custom path…". */
function normalizeCwd(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" && path.startsWith("/") ? "/" : trimmed;
}

/** Project whose cwd matches, or null → picker shows "Custom path…". */
export function matchProjectByCwd(
  projects: ProjectSummary[],
  cwd: string,
): ProjectSummary | null {
  const target = normalizeCwd(cwd);
  if (target === "") {
    return null;
  }
  return (
    projects.find(
      (project) =>
        project.cwd !== null && normalizeCwd(project.cwd) === target,
    ) ?? null
  );
}

/** Entries for the Select, in the backend's (name-sorted) order; the form
 * appends the custom entry last. */
export function projectPickerEntries(
  projects: ProjectSummary[],
): PickerEntry[] {
  return projects.map((project) => ({
    projectId: project.project_id,
    name: project.name,
    cwd: project.cwd,
    disabled: project.cwd === null,
  }));
}
