// This resolver is only for the loopback-only, single-user phase.
// The invitation/authentication slice replaces this with a session-derived context.
// Repositories always take a workspace explicitly; request bodies cannot choose it.
export function getLocalContext() {
  return { workspaceId: "local-workspace", actorId: "local-operator" } as const;
}
