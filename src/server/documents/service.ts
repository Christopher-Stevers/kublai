import { userCan } from "~/server/auth/permissions";
import { appendPackingSlip } from "./packing-slips";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import {
  jobDocumentWorkspaces,
  orders,
  materialLists,
} from "~/server/db/schema";
import {
  assertDocumentAccess,
  documentActor,
  documentMembers,
  type DocumentAccess,
} from "./access";
import {
  accessibleDocument,
  appendVersion,
  applyDocumentAction,
  emptyDocumentState,
  visibleState,
  type DocumentActor,
} from "./domain";
import { validateOfficeUrl } from "./office";
import type { DocumentAction, DocumentOverview, DocumentState } from "./types";
import { folderRole } from "./domain";

/** Receipt polling needs only matching slips and the folder ACL tree, not every
 * document version, activity entry, comment and organization member. */
export async function packingSlipDocuments(access: DocumentAccess, materialListId: string, orderId?: string, reader: Pick<typeof db, "select"> = db) {
  const [row] = await reader.select({
    folders: sql<DocumentState["folders"]>`${jobDocumentWorkspaces.state}->'folders'`,
    documents: sql<DocumentState["documents"]>`coalesce((select jsonb_agg(doc) from jsonb_array_elements(${jobDocumentWorkspaces.state}->'documents') doc
      where doc->'packingSlip'->>'materialListId' = ${materialListId}
      and (${orderId ?? null}::text is null or doc->'packingSlip'->>'orderId' = ${orderId ?? null}::text)), '[]'::jsonb)`,
  }).from(jobDocumentWorkspaces).where(and(eq(jobDocumentWorkspaces.jobId, access.job.id), eq(jobDocumentWorkspaces.organizationId, access.job.organizationId))).limit(1);
  const state = { ...emptyDocumentState(), ...row };
  const actor = documentActor(access, []);
  return state.documents.filter(doc => doc.jobId === actor.jobId && !doc.deletedAt && folderRole(state, actor, doc.folderId)).map(d => ({
    id: d.id, name: d.name, createdAt: d.createdAt, packingSlip: d.packingSlip,
    packingSlipAnalysis: d.packingSlipAnalysis, currentVersionId: d.currentVersionId,
  }));
}

export async function readWorkspace(
  access: DocumentAccess,
  reader: Pick<typeof db, "select"> = db,
): Promise<DocumentState> {
  const [row] = await reader
    .select({ state: jobDocumentWorkspaces.state })
    .from(jobDocumentWorkspaces)
    .where(
      and(
        eq(jobDocumentWorkspaces.jobId, access.job.id),
        eq(jobDocumentWorkspaces.organizationId, access.job.organizationId),
      ),
    )
    .limit(1);
  return row?.state ?? emptyDocumentState();
}
export async function documentOverview(
  access: DocumentAccess,
  reader: Pick<typeof db, "select"> = db,
): Promise<DocumentOverview> {
  const [state, members] = await Promise.all([
    readWorkspace(access, reader),
    documentMembers(access, reader),
  ]);
  const actor = documentActor(
    access,
    members.map((member) => member.id),
  );
  return {
    ...visibleState(state, actor),
    members: members.map(({ id, name, email }) => ({ id, name, email })),
    capabilities: {
      canWrite: access.canWrite,
      canManage: access.canManage,
      userId: access.user.id,
    },
    office: { mode: "linked", embeddedConfigured: false },
  };
}

/** Every mutation serializes on the job, then rechecks current org permissions. */
export async function mutateWorkspace<T>(
  userId: string,
  jobId: string,
  mutate: (
    state: DocumentState,
    actor: DocumentActor,
    access: DocumentAccess,
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => T | Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 4149))`,
    );
    const access = await assertDocumentAccess(userId, jobId, tx);
    const members = await documentMembers(access, tx);
    const [row] = await tx
      .select()
      .from(jobDocumentWorkspaces)
      .where(
        and(
          eq(jobDocumentWorkspaces.jobId, jobId),
          eq(jobDocumentWorkspaces.organizationId, access.job.organizationId),
        ),
      )
      .limit(1);
    const state: DocumentState = row?.state ?? emptyDocumentState();
    const result = await mutate(
      state,
      documentActor(
        access,
        members.map((member) => member.id),
        members.map((member) => ({
          userId: member.id,
          canWrite: member.canWrite,
          canManage: member.canManage,
        })),
      ),
      access,
      tx,
    );
    if (row)
      await tx
        .update(jobDocumentWorkspaces)
        .set({ state, revision: row.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(jobDocumentWorkspaces.jobId, jobId),
            eq(jobDocumentWorkspaces.organizationId, access.job.organizationId),
          ),
        );
    else
      await tx
        .insert(jobDocumentWorkspaces)
        .values({ jobId, organizationId: access.job.organizationId, state });
    return result;
  });
}
export async function changeDocuments(
  access: DocumentAccess,
  action: DocumentAction,
) {
  if (action.action === "linkOffice") {
    try {
      action = { ...action, webUrl: validateOfficeUrl(action.webUrl) };
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: (error as Error).message,
      });
    }
  }
  return mutateWorkspace(access.user.id, access.job.id, (state, actor) =>
    applyDocumentAction(state, actor, action),
  );
}
export async function saveDocumentVersion(
  access: DocumentAccess,
  input: Parameters<typeof appendVersion>[2] & { packingSlipOrderId?: string },
  persistBlob: () => Promise<unknown>,
) {
  return mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      let result;
      if (input.packingSlipOrderId) {
        if (!userCan(fresh.user, "orders.receive"))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Order receiving permission is required.",
          });
        const [order] = await tx
          .select({
            id: orders.id,
            status: orders.status,
            fulfillmentStatus: orders.fulfillmentStatus,
            materialListId: orders.materialListId,
            orderNumber: orders.orderNumber,
          })
          .from(orders)
          .where(
            and(
              eq(orders.id, input.packingSlipOrderId),
              eq(orders.jobId, fresh.job.id),
              eq(orders.organizationId, fresh.job.organizationId),
            ),
          )
          .for("share");
        if (!order?.materialListId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This order has no available material list.",
          });
        if (
          order.status === "draft" ||
          order.status === "cancelled" ||
          order.fulfillmentStatus === "cancelled"
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose a sent order to attach a packing slip.",
          });
        const [list] = await tx
          .select({ name: materialLists.name })
          .from(materialLists)
          .where(
            and(
              eq(materialLists.id, order.materialListId),
              eq(materialLists.jobId, fresh.job.id),
              eq(materialLists.organizationId, fresh.job.organizationId),
            ),
          )
          .for("share");
        if (!list)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Material list not found.",
          });
        // Receiving grants only this validated attachment, not general document editing.
        result = appendPackingSlip(state, { ...actor, canWrite: true }, input, {
          orderId: order.id,
          materialListId: order.materialListId,
          orderNumber: order.orderNumber ?? `Order ${order.id.slice(0, 8)}`,
          materialListName: list.name ?? "Material list",
        });
      } else result = appendVersion(state, actor, input);
      // Validate all conflicts and bounds before creating a blob; publish metadata only after bytes exist.
      await persistBlob();
      return result;
    },
  );
}
export async function readableVersion(
  access: DocumentAccess,
  versionId: string,
) {
  const state = await readWorkspace(access);
  const version = state.versions.find((entry) => entry.id === versionId);
  if (!version)
    throw new TRPCError({ code: "NOT_FOUND", message: "Version not found." });
  const doc = accessibleDocument(
    state,
    documentActor(access, []),
    version.documentId,
  );
  return { version, document: doc };
}
