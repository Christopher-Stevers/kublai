import {
  installedPostgresVersion,
  observeListenLoss,
} from "./listen-lifecycle";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Sql } from "postgres";
import { z } from "zod";
const identifier = z.string().min(1).max(255);
const hintSchema = z
  .discriminatedUnion("topic", [
    z.object({
      topic: z.literal("material"),
      materialListId: identifier,
      organizationId: identifier.nullish(),
      kind: z.enum(["created", "updated", "deleted"]),
    }),
    z.object({
      topic: z.literal("preferences"),
      organizationId: identifier,
      scope: z.enum(["personal", "executive"]),
      userId: identifier.optional(),
      eventId: z.string().uuid(),
    }),
    z.object({
      topic: z.literal("timesheets"),
      organizationId: identifier,
      scope: z.enum(["personal", "organization"]),
      userId: identifier.optional(),
      eventId: z.string().uuid(),
    }),
    z.object({ topic: z.literal("poke"), organizationId: identifier }),
    z.object({ topic: z.literal("catalogue"), organizationId: identifier }),
    z.object({ topic: z.literal("conversation"), conversationId: identifier }),
    z.object({ topic: z.literal("work"), feature: z.literal("packing-slips") }),
  ])
  .superRefine((hint, context) => {
    if (
      (hint.topic === "preferences" || hint.topic === "timesheets") &&
      (hint.scope === "personal" ? !hint.userId : hint.userId !== undefined)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid hint audience",
      });
  });
export type BackgroundHint = z.infer<typeof hintSchema>;
const envelope = z.object({ origin: z.string().uuid(), hint: hintSchema });
type HintState = {
  origin: string;
  emitter: EventEmitter;
  connection?: Sql;
  starting?: Promise<void>;
  listenerReady?: boolean;
  stopLifecycle?: () => void;
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
    // Transactional preference/timesheet writers emit only after commit. Their own LISTEN
    // delivery is the post-commit source, including the writing web process.
    if (
      parsed.origin !== origin ||
      parsed.hint.topic === "preferences" ||
      parsed.hint.topic === "timesheets"
    )
      emitter.emit("hint", parsed.hint);
  } catch {
    /* invalid transport hint */
  }
}
/** Shared listener epoch: consumers perform authoritative catch-up after every
 * initial LISTEN/resubscribe. The callback carries no account or private data. */
export function onBackgroundHintReconnect(
  listener: (revision: string) => void,
) {
  emitter.on("reconnected", listener);
  return () => {
    emitter.off("reconnected", listener);
  };
}
/** Only healthy when the pinned real LISTEN pool lifecycle is observable. */
export function onBackgroundHintAvailability(
  listener: (ready: boolean) => void,
) {
  emitter.on("availability", listener);
  listener(state.listenerReady === true);
  return () => {
    emitter.off("availability", listener);
  };
}
function listenerAvailability(ready: boolean) {
  if (state.listenerReady === ready) return;
  state.listenerReady = ready;
  emitter.emit("availability", ready);
}
export function transactionalBackgroundHint(hint: BackgroundHint) {
  const parsed = hintSchema.parse(hint);
  if (
    parsed.topic === "preferences" &&
    (parsed.scope === "personal" ? !parsed.userId : parsed.userId !== undefined)
  )
    throw Error("Invalid hint audience");
  return JSON.stringify({ origin, hint: parsed });
}
export function startBackgroundHints() {
  if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL)
    return Promise.resolve();
  return (state.starting ??= (async () => {
    const { default: postgres } = await import("postgres");
    state.connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    const connection = state.connection;
    let observed = false;
    const listening = connection.listen(
      "foremanhq_change",
      acceptBackgroundHint,
      () => {
        if (state.connection !== connection) return;
        listenerAvailability(observed);
        emitter.emit("reconnected", randomUUID());
      },
    );
    state.stopLifecycle?.();
    const stop = observeListenLoss(
      connection,
      installedPostgresVersion(),
      () => {
        if (state.connection === connection) listenerAvailability(false);
      },
    );
    observed = stop !== null;
    state.stopLifecycle = stop ?? undefined;
    await listening;
  })().catch(async () => {
    listenerAvailability(false);
    state.stopLifecycle?.();
    state.stopLifecycle = undefined;
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
