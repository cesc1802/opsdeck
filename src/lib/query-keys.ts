export const queryKeys = {
  projects: ["projects"] as const,
  sessions: (projectId: string) => ["sessions", projectId] as const,
  session: (projectId: string, sessionId: string) =>
    ["session", projectId, sessionId] as const,
  pricing: ["pricing"] as const,
};
