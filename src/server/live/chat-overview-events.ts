import {
  onBackgroundHint,
  onBackgroundHintReconnect,
  startBackgroundHints,
} from "~/server/background/hints";
/** Only jobs already admitted by the existing chat source are eligible. Actor
 * identifiers stay server-side, including effective-user simulation identity. */
export function subscribeChatOverviewEvents(
  audience: {
    organizationId: string;
    userId: string;
    jobIds: ReadonlySet<string>;
  },
  invalidate: (
    jobId: string,
    kind: "changed" | "resync",
    revision: string,
  ) => void,
) {
  let active = true;
  const stop = onBackgroundHint((hint) => {
    if (
      active &&
      hint.topic === "chat-overview" &&
      hint.organizationId === audience.organizationId &&
      hint.userId === audience.userId &&
      audience.jobIds.has(hint.jobId)
    )
      invalidate(hint.jobId, "changed", hint.eventId);
  });
  const reconnect = onBackgroundHintReconnect((revision) => {
    if (active)
      for (const jobId of audience.jobIds)
        invalidate(jobId, "resync", revision);
  });
  void startBackgroundHints();
  return () => {
    active = false;
    stop();
    reconnect();
  };
}
