import { and, eq, sql } from "drizzle-orm";
import type { PatchOperation, PullRequest as PullRequestV1, PullResponse as PullResponseV1 } from "replicache";
import { db } from "~/server/db";
import { replicacheClientGroups, replicacheClients } from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import { redactFinancialValues } from "~/lib/financial-visibility";
import { ReplicacheViews } from "./views";

export class ReplicacheOwnershipError extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type User = { id: string; organizationId: string | null; role?: string | null;
  permissionConfig?: unknown; stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null; subscriptionEndsAt?: Date | string | null };
const views = new ReplicacheViews();

export async function ensureClientGroup(
  tx: Tx,
  input: {
    clientGroupId: string;
    organizationId: string;
    userId: string;
    schemaVersion: string;
  },
) {
  await tx
    .insert(replicacheClientGroups)
    .values({
      id: input.clientGroupId,
      organizationId: input.organizationId,
      userId: input.userId,
      schemaVersion: input.schemaVersion,
    })
    .onConflictDoNothing();
  // This write serializes pulls and pushes for the same client group. The
  // ownership predicate also covers concurrent first-registration attempts.
  const [group] = await tx
    .update(replicacheClientGroups)
    .set({ schemaVersion: input.schemaVersion, updatedAt: new Date() })
    .where(
      and(
        eq(replicacheClientGroups.id, input.clientGroupId),
        eq(replicacheClientGroups.organizationId, input.organizationId),
        eq(replicacheClientGroups.userId, input.userId),
      ),
    )
    .returning({ id: replicacheClientGroups.id });
  if (!group)
    throw new ReplicacheOwnershipError(
      "Replicache client group ownership mismatch",
    );
}

async function revision(
  tx: Tx,
  kind: "catalogue" | "material-lists",
  org: string,
) {
  const rows = await tx.execute<{ revision: string }>(sql`
    select concat(
      coalesce((select revision from kublai_sync_revision where kind = ${kind} and scope = '*'), 0), ':',
      coalesce((select revision from kublai_sync_revision where kind = ${kind} and scope = ${org}), 0)
    ) as revision
  `);
  return rows[0]!.revision;
}

function serializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    ("code" in error && error.code === "40001") ||
    ("cause" in error && serializationFailure(error.cause))
  );
}

export async function pullSnapshot(
  kind: "catalogue" | "material-lists",
  request: PullRequestV1,
  user: User,
  build: (tx: Tx) => Promise<PatchOperation[]>,
): Promise<PullResponseV1> {
  if (!user.organizationId)
    throw new Error("User must belong to an organization");
  const org = user.organizationId;
  const showMoney = userCan(user, "financial.view");
  const scope = `${kind}:${org}:${request.schemaVersion}:view-v3:money-${showMoney}`;
  const receivedOrder =
    request.cookie &&
    typeof request.cookie === "object" &&
    "order" in request.cookie
      ? request.cookie.order
      : 0;
  const priorOrder =
    typeof receivedOrder === "number" &&
    Number.isSafeInteger(receivedOrder) &&
    receivedOrder >= 0 &&
    receivedOrder < Number.MAX_SAFE_INTEGER - 1
      ? receivedOrder
      : 0;
  const started = Date.now();
  let revisionMs = 0;
  let buildMs: number | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.transaction(
        async (tx) => {
          await ensureClientGroup(tx, {
            clientGroupId: request.clientGroupID,
            organizationId: org,
            userId: user.id,
            schemaVersion: request.schemaVersion,
          });
          const [group] = await tx
            .update(replicacheClientGroups)
            .set({
              lastPullOrder: sql`greatest(${replicacheClientGroups.lastPullOrder} + 1, floor(extract(epoch from clock_timestamp()) * 1000)::bigint, ${priorOrder + 1})`,
            })
            .where(eq(replicacheClientGroups.id, request.clientGroupID))
            .returning({ order: replicacheClientGroups.lastPullOrder });
          const clients = await tx
            .select({
              id: replicacheClients.id,
              lastMutationId: replicacheClients.lastMutationId,
            })
            .from(replicacheClients)
            .where(eq(replicacheClients.clientGroupId, request.clientGroupID));
          const revisionStart = Date.now();
          const fingerprint = await revision(tx, kind, org);
          revisionMs = Date.now() - revisionStart;
          let view = views.find(scope, fingerprint);
          if (!view) {
            const buildStart = Date.now();
            const patch = await build(tx);
            view = views.create(scope, fingerprint, showMoney ? patch : redactFinancialValues(patch));
            buildMs = Date.now() - buildStart;
          }
          return {
            view,
            response: {
              cookie: { order: Number(group!.order), cvr: view.id },
              lastMutationIDChanges: Object.fromEntries(
                clients.map((c) => [c.id, c.lastMutationId]),
              ),
              patch: views.diff(view, request.cookie),
            },
          };
        },
        { isolationLevel: "repeatable read" },
      );
      // Publish only committed views. Eviction/restart simply falls back to clear.
      views.remember(result.view);
      console.log(
        `[replicache] ${kind} pull took ${Date.now() - started}ms (revision ${revisionMs}ms, ${buildMs === null ? "cached view" : `build ${buildMs}ms`}, ${result.response.patch.length} patch ops, attempt ${attempt + 1})`,
      );
      return result.response;
    } catch (error) {
      if (attempt >= 3 || !serializationFailure(error)) throw error;
    }
  }
}
