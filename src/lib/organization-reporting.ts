/** Check the proposed outgoing lines against the rest of the reporting graph. */
export function reportingWouldCycle(
  userId: string,
  reportsToUserIds: readonly string[],
  lines: readonly { userId: string; reportsToUserId: string }[],
) {
  const next = new Map<string, string[]>();
  for (const line of lines) {
    if (line.userId === userId) continue;
    const managers = next.get(line.userId) ?? [];
    managers.push(line.reportsToUserId);
    next.set(line.userId, managers);
  }
  const pending = [...reportsToUserIds];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === userId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(next.get(id) ?? []));
  }
  return false;
}
