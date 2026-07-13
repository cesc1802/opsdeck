// Thin typed client over the tauri-specta bindings: unwraps the generated
// Result envelope into thrown Errors so TanStack Query sees failures.
import {
  commands,
  type PricingTable,
  type ProjectSummary,
  type Result,
  type SessionDetail,
  type SessionMeta,
} from "./bindings";

function unwrap<T>(result: Result<T, string>): T {
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  return unwrap(await commands.listProjects());
}

export async function fetchSessions(projectId: string): Promise<SessionMeta[]> {
  return unwrap(await commands.listSessions(projectId));
}

export async function fetchSession(
  projectId: string,
  sessionId: string,
): Promise<SessionDetail> {
  return unwrap(await commands.getSession(projectId, sessionId));
}

export async function fetchPricing(): Promise<PricingTable> {
  return commands.getPricing();
}
