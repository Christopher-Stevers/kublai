/** Identifier-only invalidation hints. A version is scoped to this connection's
 * server epoch; authorized API reads remain the source of truth. */
export type LiveTopic =
  | "material"
  | "replicache"
  | "catalogue"
  | "conversations"
  | "chat-overview"
  | "chat"
  | "preferences"
  | "timesheets";
export type LiveHint = {
  topic: LiveTopic;
  version: number;
  key?: string;
  kind?: string;
  sourceClientGroupId?: string | null;
};
export function liveHint(value: unknown): LiveHint | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    ![
      "material",
      "replicache",
      "catalogue",
      "conversations",
      "chat",
      "chat-overview",
      "preferences",
      "timesheets",
    ].includes(String(row.topic)) ||
    !Number.isSafeInteger(row.version) ||
    (row.version as number) < 0
  )
    return null;
  if (
    row.key !== undefined &&
    (typeof row.key !== "string" || row.key.length > 255)
  )
    return null;
  if (
    row.kind !== undefined &&
    (typeof row.kind !== "string" || row.kind.length > 40)
  )
    return null;
  if (
    row.sourceClientGroupId !== undefined &&
    row.sourceClientGroupId !== null &&
    (typeof row.sourceClientGroupId !== "string" ||
      row.sourceClientGroupId.length > 255)
  )
    return null;
  return {
    topic: row.topic as LiveTopic,
    version: row.version as number,
    ...(row.key === undefined ? {} : { key: row.key }),
    ...(row.kind === undefined ? {} : { kind: row.kind }),
    ...(row.sourceClientGroupId === undefined
      ? {}
      : { sourceClientGroupId: row.sourceClientGroupId }),
  };
}

/** Match the account boundary used by drawing/device stores, including simulation. */
export function liveAccountScope(
  organizationId: string,
  userId: string,
  simulationId?: string | null,
) {
  return `${organizationId}:${userId}${simulationId ? `:simulation:${simulationId}` : ""}`;
}
