import { randomUUID } from "node:crypto";
import type { LiveHint } from "~/lib/live-protocol";
export type LiveFrame = { id: string; scope: string; hint: LiveHint };
export class LiveHub {
  readonly epoch = randomUUID();
  private sequence = 0;
  private frames: LiveFrame[] = [];
  private deduplicated = new Map<string, LiveFrame>();
  private dedupeKeys = new Map<string, string>();
  private listeners = new Set<(frame: LiveFrame) => void>();
  constructor(private limit = 512) {}
  publish(
    scope: string,
    hint: Omit<LiveHint, "version"> & { version?: number },
    revision?: string,
  ) {
    const key =
      hint.version !== undefined || revision !== undefined
        ? JSON.stringify([
            scope,
            hint.topic,
            hint.key,
            hint.version ?? revision,
            hint.kind,
            hint.sourceClientGroupId,
          ])
        : undefined;
    if (key) {
      const previous = this.deduplicated.get(key);
      if (previous) return previous;
    }
    const sequence = ++this.sequence,
      frame = {
        id: `${this.epoch}:${sequence}`,
        scope,
        hint: { ...hint, version: hint.version ?? sequence },
      };
    this.frames.push(frame);
    if (key) {
      this.deduplicated.set(key, frame);
      this.dedupeKeys.set(frame.id, key);
    }
    if (this.frames.length > this.limit) {
      const removed = this.frames.shift()!,
        oldKey = this.dedupeKeys.get(removed.id);
      if (oldKey) this.deduplicated.delete(oldKey);
      this.dedupeKeys.delete(removed.id);
    }
    for (const listener of this.listeners) listener(frame);
    return frame;
  }
  subscribe(listener: (frame: LiveFrame) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  resume(scope: string, cursor: string | null) {
    const match = cursor?.match(/^([a-f0-9-]{36}):(\d+)$/),
      after = Number(match?.[2]);
    if (
      !match ||
      match[1] !== this.epoch ||
      !Number.isSafeInteger(after) ||
      after > this.sequence ||
      after < Number(this.frames[0]?.id.split(":")[1] ?? this.sequence) - 1
    )
      return { reset: true, frames: [] as LiveFrame[] };
    return {
      reset: false,
      frames: this.frames.filter(
        (frame) =>
          frame.scope === scope && Number(frame.id.split(":")[1]) > after,
      ),
    };
  }
}
const shared = globalThis as typeof globalThis & { __foremanLiveHub?: LiveHub };
export const liveHub = (shared.__foremanLiveHub ??= new LiveHub());
