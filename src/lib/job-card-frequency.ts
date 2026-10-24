export const JOB_CARD_ORDER = [
  "material-lists",
  "drawings",
  "chat",
  "documents",
  "tools",
  "rooms",
  "models",
  "systems",
] as const;
export type JobCardId = (typeof JOB_CARD_ORDER)[number];
type Usage = { score: number; at: number };
export type JobCardPreferences = {
  frequent: boolean;
  usage: Partial<Record<JobCardId, Usage>>;
};
const HALF_LIFE = 30 * 86400000;
export const emptyJobCardPreferences = (): JobCardPreferences => ({
  frequent: true,
  usage: {},
});
export function readJobCardPreferences(key: string): JobCardPreferences {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(key) ?? "{}",
    ) as JobCardPreferences;
    const usage: JobCardPreferences["usage"] = {};
    for (const id of JOB_CARD_ORDER) {
      const item = raw.usage?.[id];
      if (
        item &&
        Number.isFinite(item.score) &&
        item.score >= 0 &&
        Number.isFinite(item.at)
      )
        usage[id] = item;
    }
    return { frequent: raw.frequent !== false, usage };
  } catch {
    return emptyJobCardPreferences();
  }
}
function score(item: Usage | undefined, now: number) {
  return item ? item.score * 2 ** (-Math.max(0, now - item.at) / HALF_LIFE) : 0;
}
export function rankJobCards(
  prefs: JobCardPreferences,
  now = Date.now(),
): JobCardId[] {
  return [...JOB_CARD_ORDER].sort((a, b) => {
    if (a === "systems" || b === "systems")
      return Number(a === "systems") - Number(b === "systems");
    return prefs.frequent
      ? score(prefs.usage[b], now) - score(prefs.usage[a], now)
      : 0;
  });
}
export function recordJobCard(
  prefs: JobCardPreferences,
  id: JobCardId,
  now = Date.now(),
): JobCardPreferences {
  return {
    ...prefs,
    usage: {
      ...prefs.usage,
      [id]: { score: score(prefs.usage[id], now) + 1, at: now },
    },
  };
}
export function saveJobCardPreferences(key: string, prefs: JobCardPreferences) {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* Navigation still works without storage. */
  }
}
