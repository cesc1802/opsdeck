export const queryKeys = {
  projects: ["projects"] as const,
  sessions: (projectId: string) => ["sessions", projectId] as const,
  session: (projectId: string, sessionId: string) =>
    ["session", projectId, sessionId] as const,
  pricing: ["pricing"] as const,
  jobs: ["jobs"] as const,
  chatConfig: ["chat-config"] as const,
  completions: (cwd: string) => ["completions", cwd] as const,
  profiles: ["profiles"] as const,
  stats: ["stats"] as const,
};
