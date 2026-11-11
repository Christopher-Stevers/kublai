import type { speedScreen } from "./speed-telemetry";

export type SpeedContext = {
  screen: ReturnType<typeof speedScreen>;
  link: "offline" | "slow" | "cellular" | "fast" | "unknown";
};
const unknown: SpeedContext = { screen: "other", link: "unknown" };

/** Only coarse labels and monotonic times live here, never paths or IDs.
 * Final vitals can describe an interaction on an earlier SPA screen. */
export class SpeedContextTimeline {
  private readonly entries: { at: number; context: SpeedContext }[];
  constructor(initial: SpeedContext) {
    this.entries = [{ at: 0, context: { ...initial } }];
  }
  record(at: number, context: SpeedContext) {
    const last = this.entries.at(-1)!;
    if (!Number.isFinite(at) || at < last.at) return;
    if (
      last.context.screen === context.screen &&
      last.context.link === context.link
    )
      return;
    if (at === last.at) this.entries.pop();
    this.entries.push({ at, context: { ...context } });
    if (this.entries.length > 256) this.entries.shift();
  }
  at(time: number): SpeedContext {
    if (!Number.isFinite(time) || time < 0) return { ...unknown };
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry = this.entries[index]!;
      if (entry.at <= time) return { ...entry.context };
    }
    return { ...unknown };
  }
  forVital(entries?: readonly { startTime: number }[]): SpeedContext {
    const first =
      entries?.reduce(
        (at, entry) =>
          Number.isFinite(entry.startTime) ? Math.min(at, entry.startTime) : at,
        Infinity,
      ) ?? Infinity;
    return this.at(first);
  }
}
