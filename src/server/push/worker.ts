import { sql } from "drizzle-orm";
import type { db } from "~/server/db";
import { pushFailure } from "~/server/chat/push-policy";

type Outbox =
  | "kublai_chat_push_outbox"
  | "kublai_conversation_push_outbox"
  | "kublai_drawing_push_outbox"
  | "kublai_material_push_outbox";
type Delivery = {
  id: string;
  leaseToken: string;
  attempts: number;
  subscriptionId: string;
  recipientId: string;
  endpoint: string;
};
type Database = Pick<typeof db, "execute">;
export function pushSettler(database: Database, table: Outbox) {
  return async (
    delivery: Pick<Delivery, "id" | "leaseToken">,
    outcome: string,
    retryMs?: number,
  ) => {
    await database.execute(sql`update ${sql.identifier(table)} set "completedAt"=${retryMs === undefined ? sql`now()` : sql`null`},outcome=${outcome},
     "availableAt"=now()+(${retryMs ?? 0}*interval '1 millisecond'),"leaseToken"=null,"leasedUntil"=null where id=${delivery.id} and "leaseToken"=${delivery.leaseToken}`);
  };
}
/** Call only after the feature's fresh authorization and lease checks. */
export async function deliverAuthorizedPush(
  database: Database,
  delivery: Delivery,
  settle: ReturnType<typeof pushSettler>,
  send: () => Promise<unknown>,
) {
  try {
    await send();
    await settle(delivery, "sent");
  } catch (error) {
    const failure = pushFailure(error, delivery.attempts);
    if (failure.outcome === "expired") {
      await database.execute(
        sql`DELETE FROM kublai_chat_push_subscription where id=${delivery.subscriptionId} and "userId"=${delivery.recipientId} and endpoint=${delivery.endpoint}`,
      );
    } else
      await settle(
        delivery,
        failure.outcome,
        failure.permanent ? undefined : failure.retryMs,
      );
  }
}
const state = globalThis as typeof globalThis & {
  pushWorkers?: Map<string, { timer: NodeJS.Timeout; running: boolean }>;
};
export function startPushWorker(
  key: string,
  drain: () => Promise<void>,
  warning: string,
) {
  const workers = (state.pushWorkers ??= new Map());
  if (workers.has(key)) return;
  const worker = {
    timer: undefined as unknown as NodeJS.Timeout,
    running: false,
  };
  const run = async () => {
    if (worker.running) return;
    worker.running = true;
    try {
      await drain();
    } catch {
      console.warn(warning);
    } finally {
      worker.running = false;
    }
  };
  worker.timer = setInterval(() => void run(), 15000);
  worker.timer.unref();
  workers.set(key, worker);
  void run();
}
