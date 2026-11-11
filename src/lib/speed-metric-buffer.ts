import type { SpeedMetric, speedScreen } from "./speed-telemetry";

export type BufferedSpeedMetric = SpeedMetric & {
  screen: ReturnType<typeof speedScreen>;
  link: string;
};
type Pool = "vital" | "journey" | "diagnostic";
const budget: Record<Pool, number> = { vital: 10, journey: 60, diagnostic: 50 };
const priority: Record<Pool, number> = { vital: 2, journey: 1, diagnostic: 0 };
const pool = ({ name }: SpeedMetric): Pool =>
  name === "inp" || name === "lcp" ? "vital" :
    ["tap-to-paint", "write-to-paint", "app-start-to-last-screen", "sheet-open-to-sharp"].includes(name)
      ? "journey" : "diagnostic";

/** Keep the same 30 queued / 120 sent limits without allowing raw EventTiming
 * traffic to consume the space needed by late Web Vitals or journey marks.
 * These are bounded diagnostic samples, not an unbiased interaction census. */
export class SpeedMetricBuffer {
  private queue: BufferedSpeedMetric[] = [];
  private sent: Record<Pool, number> = { vital: 0, journey: 0, diagnostic: 0 };

  push(metric: BufferedSpeedMetric) {
    const category = pool(metric);
    if (this.sent[category] + this.queue.filter(row => pool(row) === category).length >= budget[category]) return;
    if (this.queue.length >= 30) {
      const lowest = Math.min(...this.queue.map(row => priority[pool(row)]));
      if (priority[category] <= lowest) return;
      this.queue.splice(this.queue.findIndex(row => priority[pool(row)] === lowest), 1);
    }
    this.queue.push(metric);
  }

  peekBatch(): BufferedSpeedMetric[] {
    if (!this.queue.length) return [];
    const highest = Math.max(...this.queue.map(row => priority[pool(row)]));
    const first = this.queue.find(row => priority[pool(row)] === highest)!;
    return this.queue.filter(row => row.screen === first.screen && row.link === first.link);
  }

  /** Call only after sendBeacon accepted this exact batch. Failed sends retain it. */
  acknowledge(batch: readonly BufferedSpeedMetric[]) {
    const accepted = new Set(batch);
    this.queue = this.queue.filter(row => {
      if (!accepted.has(row)) return true;
      this.sent[pool(row)]++;
      return false;
    });
  }
}
