import {
  onBackgroundHint,
  onBackgroundHintReconnect,
  startBackgroundHints,
} from "~/server/background/hints";

type Audience = { organizationId: string; userId: string };
/** Settings are shared across direct/simulated views of the effective user.
 * The caller publishes into its separately authenticated full simulation scope.
 * Hints never contain settings, capability values or audience identifiers. */
export function subscribeMaterialSortEvents(
  audience: Audience,
  invalidate: (kind: "settings" | "resync", revision: string) => void,
) {
  let active = true;
  const unsubscribe = onBackgroundHint((hint) => {
    if (
      !active ||
      hint.topic !== "preferences" ||
      hint.organizationId !== audience.organizationId ||
      (hint.scope === "personal" && hint.userId !== audience.userId)
    )
      return;
    invalidate("settings", hint.eventId);
  });
  const reconnect = onBackgroundHintReconnect((revision) => {
    if (active) invalidate("resync", revision);
  });
  // Best effort remains explicit: the unchanged HTTP authority poll recovers
  // missed notifications while this shared LISTEN connection is unavailable.
  void startBackgroundHints();
  return () => {
    active = false;
    unsubscribe();
    reconnect();
  };
}
