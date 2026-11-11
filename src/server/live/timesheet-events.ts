import {
  onBackgroundHint,
  onBackgroundHintReconnect,
  startBackgroundHints,
} from "~/server/background/hints";
/** Audience stays server-side; the shared browser frame contains no actor,
 * sheet, timer, membership, notes, totals or capability data. */
export function subscribeTimesheetEvents(
  audience: { organizationId: string; userId: string; canManage: boolean },
  invalidate: (kind: "changed" | "resync", revision: string) => void,
) {
  let active = true;
  const stop = onBackgroundHint((hint) => {
    if (
      !active ||
      hint.topic !== "timesheets" ||
      hint.organizationId !== audience.organizationId
    )
      return;
    if (
      hint.scope === "personal" &&
      hint.userId !== audience.userId &&
      !audience.canManage
    )
      return;
    invalidate("changed", hint.eventId);
  });
  const reconnect = onBackgroundHintReconnect((revision) => {
    if (active) invalidate("resync", revision);
  });
  void startBackgroundHints();
  return () => {
    active = false;
    stop();
    reconnect();
  };
}
