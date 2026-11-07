import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Sql } from "postgres";
import { z } from "zod";
const identifier = z.string().min(1).max(255);
const hintSchema = z.discriminatedUnion("topic", [
  z.object({
    topic: z.literal("material"),
    materialListId: identifier,
    organizationId: identifier.nullish(),
    kind: z.enum(["created", "updated", "deleted"]),
  }),
  z.object({ topic: z.literal("poke"), organizationId: identifier }),
  z.object({ topic: z.literal("catalogue"), organizationId: identifier }),
  z.object({ topic: z.literal("conversation"), conversationId: identifier }),
  z.object({ topic: z.literal("work"), feature: z.literal("packing-slips") }),
]);
export type BackgroundHint = z.infer<typeof hintSchema>;
const envelope = z.object({ origin: z.string().uuid(), hint: hintSchema });
type HintState = {
  origin: string;
  emitter: EventEmitter;
  connection?: Sql;
  starting?: Promise<void>;
};
const shared = globalThis as typeof globalThis & {
  __foremanBackgroundHints?: HintState;
};
const state = (shared.__foremanBackgroundHints ??= {
  origin: randomUUID(),
  emitter: new EventEmitter(),
});
const { origin, emitter } = state;
/** Hints contain identifiers only. Durable revisions and authorized polling recover missed hints. */
export function onBackgroundHint(listener: (hint: BackgroundHint) => void) {
  emitter.on("hint", listener);
  return () => {
    emitter.off("hint", listener);
  };
}
export function acceptBackgroundHint(payload: string) {
  if (payload.length > 4096) return;
  try {
    const parsed = envelope.parse(JSON.parse(payload));
    if (parsed.origin !== origin) emitter.emit("hint", parsed.hint);
  } catch {
    /* invalid transport hint */
  }
}
export function startBackgroundHints() {
  if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL)
    return Promise.resolve();
  return (state.starting ??= (async () => {
    const { default: postgres } = await import("postgres");
    state.connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    await state.connection.listen("foremanhq_change", acceptBackgroundHint);
  })().catch(async () => {
    const failed = state.connection;
    state.connection = undefined;
    await failed?.end({ timeout: 1 }).catch(() => undefined);
    state.starting = undefined;
    console.warn("Realtime hints unavailable; polling remains active.");
  }));
}
export function publishBackgroundHint(hint: BackgroundHint) {
  if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) return;
  void startBackgroundHints()
    .then(async () => {
      const parsed = hintSchema.parse(hint);
      await state.connection?.notify(
        "foremanhq_change",
        JSON.stringify({ origin, hint: parsed }),
      );
    })
    .catch(() => {
      /* Authoritative records remain available to polling. */
    });
}
