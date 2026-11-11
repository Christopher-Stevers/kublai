// Shared synchronous account-clear registry. Keep this module independent of
// geometry/PDF engines so global account cleanup does not load those engines.
const clients = new Set<{ dispose: () => void }>();

/** Register other drawing workers with the same account lifecycle. */
export function registerDrawingWorker(client: { dispose: () => void }) {
  clients.add(client);
  return () => clients.delete(client);
}

/** Private drawing work must not survive logout or an account switch. */
export function clearDrawingGeometryWorkers() {
  for (const client of [...clients]) client.dispose();
}
