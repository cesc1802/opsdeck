// Thin typed client over the tauri-specta bindings: unwraps the generated
// Result envelope into thrown Errors so TanStack Query sees failures.
import {
  commands,
  type ChatConfig,
  type ChatProfile,
  type ExportFormat,
  type FieldError,
  type HealthCheck,
  type HookRow,
  type JobSummary,
  type LaunchOptions,
  type PricingTable,
  type ProjectSummary,
  type Result,
  type SessionDetail,
  type SessionMeta,
  type WorkspaceStats,
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

export async function fetchStats(): Promise<WorkspaceStats> {
  return unwrap(await commands.getStats());
}

export async function exportSession(
  projectId: string,
  sessionId: string,
  format: ExportFormat,
  redact: boolean,
): Promise<string> {
  return unwrap(
    await commands.exportSession(projectId, sessionId, format, redact),
  );
}

export async function writeExport(
  path: string,
  content: string,
): Promise<void> {
  unwrap(await commands.writeExport(path, content));
}

export async function createJob(options: LaunchOptions): Promise<JobSummary> {
  return unwrap(await commands.createJob(options));
}

export async function fetchJobs(): Promise<JobSummary[]> {
  return unwrap(await commands.listJobs());
}

export async function fetchChatConfig(): Promise<ChatConfig> {
  return commands.getChatConfig();
}

export async function validateDir(path: string): Promise<boolean> {
  return commands.validateDir(path);
}

export async function validateLaunchOptions(
  options: LaunchOptions,
): Promise<FieldError[]> {
  return commands.validateLaunchOptions(options);
}

export async function fetchJob(jobId: string): Promise<JobSummary> {
  return unwrap(await commands.getJob(jobId));
}

export async function sendUserMessage(
  jobId: string,
  text: string,
): Promise<void> {
  unwrap(await commands.sendUserMessage(jobId, text));
}

export async function interruptJob(jobId: string): Promise<void> {
  unwrap(await commands.interruptJob(jobId));
}

export async function stopJob(jobId: string): Promise<void> {
  unwrap(await commands.stopJob(jobId));
}

export async function fetchProfiles(): Promise<ChatProfile[]> {
  return unwrap(await commands.listProfiles());
}

export async function saveProfile(
  name: string,
  prevName: string | null,
  options: LaunchOptions,
  hookBuilder: HookRow[],
): Promise<ChatProfile> {
  return unwrap(await commands.saveProfile(name, prevName, options, hookBuilder));
}

export async function deleteProfile(name: string): Promise<void> {
  unwrap(await commands.deleteProfile(name));
}

export async function exportProfiles(path: string): Promise<void> {
  unwrap(await commands.exportProfiles(path));
}

export async function importProfiles(path: string): Promise<number> {
  return unwrap(await commands.importProfiles(path));
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  return unwrap(await commands.runHealthChecks());
}

export async function listBackgroundAgents(): Promise<string> {
  return unwrap(await commands.listBackgroundAgents());
}

export async function launchBackgroundAgent(prompt: string): Promise<string> {
  return unwrap(await commands.launchBackgroundAgent(prompt));
}
