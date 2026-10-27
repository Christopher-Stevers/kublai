import { userCan } from "~/server/auth/permissions";
import {
  appendPackingSlip,
  appendUnmatchedSlip,
  linkSavedSlip,
} from "./packing-slips";
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
import type {
  DocumentAction,
  DocumentOverview,
  DocumentState,
  PackingSlipLink,
} from "./types";
import { folderRole } from "./domain";

/** Receipt polling needs only matching slips and the folder ACL tree, not every
 * document version, activity entry, comment and organization member. */
export async function packingSlipDocuments(
  access: DocumentAccess,
  materialListId: string,
  orderId?: string,
  reader: Pick<typeof db, "select"> = db,
) {
  const [row] = await reader
    .select({
      folders: sql<
        DocumentState["folders"]
      >`${jobDocumentWorkspaces.state}->'folders'`,
      documents: sql<
        DocumentState["documents"]
      >`coalesce((select jsonb_agg(doc) from jsonb_array_elements(${jobDocumentWorkspaces.state}->'documents') doc
      where doc->'packingSlip'->>'materialListId' = ${materialListId}
      and (${orderId ?? null}::text is null or doc->'packingSlip'->>'orderId' = ${orderId ?? null}::text)), '[]'::jsonb)`,
    })
    .from(jobDocumentWorkspaces)
    .where(
      and(
        eq(jobDocumentWorkspaces.jobId, access.job.id),
        eq(jobDocumentWorkspaces.organizationId, access.job.organizationId),
      ),
    )
    .limit(1);
  const state = { ...emptyDocumentState(), ...row };
  const actor = documentActor(access, []);
  return state.documents
    .filter(
      (doc) =>
        doc.jobId === actor.jobId &&
        !doc.deletedAt &&
        folderRole(state, actor, doc.folderId),
    )
    .map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      packingSlip: d.packingSlip,
      packingSlipAnalysis: d.packingSlipAnalysis,
      receivingReview: d.receivingReview ? {pending:d.receivingReview.lines.filter(l=>!l.ignored&&(l.approved?.quantity!==l.quantity||l.approved.kind!==(l.kind??d.receivingReview!.kind))).length,complete:!!d.receivingReview.documentChecked&&!!d.receivingReview.orderConfirmed,retired:!!d.receivingReview.retiredBy||d.receivingReview.duplicateDecision?.action==='supporting'} : d.packingSlipAnalysis ? {pending:d.packingSlipAnalysis.applied?0:d.packingSlipAnalysis.lines.length,complete:!!d.packingSlipAnalysis.applied,retired:false}:undefined,
      currentVersionId: d.currentVersionId,
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
/** A sent, active order of this job that the member may receive, as a slip link. */
async function receivableOrder(
  tx: Pick<typeof db, "select">,
  fresh: DocumentAccess,
  orderId: string,
): Promise<PackingSlipLink> {
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
        eq(orders.id, orderId),
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
  return {
    orderId: order.id,
    materialListId: order.materialListId,
    orderNumber: order.orderNumber ?? `Order ${order.id.slice(0, 8)}`,
    materialListName: list.name ?? "Material list",
  };
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
        const link = await receivableOrder(tx, fresh, input.packingSlipOrderId);
        // Receiving grants only this validated attachment, not general document editing.
        result = appendPackingSlip(
          state,
          { ...actor, canWrite: true },
          input,
          link,
        );
      } else result = appendVersion(state, actor, input);
      // Validate all conflicts and bounds before creating a blob; publish metadata only after bytes exist.
      await persistBlob();
      return result;
    },
  );
}
/** Saves a scanned slip in Packing Slips before its order is chosen. */
export async function saveUnmatchedSlip(
  access: DocumentAccess,
  input: Parameters<typeof appendVersion>[2],
  persistBlob: () => Promise<unknown>,
) {
  return mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh) => {
      if (!userCan(fresh.user, "orders.receive"))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Order receiving permission is required.",
        });
      // As with linked slips, receiving grants only this new attachment.
      const result = appendUnmatchedSlip(
        state,
        { ...actor, canWrite: true },
        input,
      );
      await persistBlob();
      return result;
    },
  );
}
/** Links a saved slip to one of the job's sent orders. */
export async function attachSavedSlip(
  access: DocumentAccess,
  documentId: string,
  orderId: string,
) {
  return mutateWorkspace(
    access.user.id,
    access.job.id,
    async (state, actor, fresh, tx) => {
      const link = await receivableOrder(tx, fresh, orderId);
      return { ...linkSavedSlip(state, actor, documentId, link), ...link };
    },
  );
}
/** Slips the member can open: linked ones and anything in Packing Slips. */
export async function savedPackingSlips(access: DocumentAccess) {
  const state = await readWorkspace(access);
  const actor = documentActor(access, []);
  const folder = state.folders.find(
    (f) =>
      f.parentId === null && f.name.trim().toLowerCase() === "packing slips",
  );
  return state.documents
    .filter((d) => {
      if (d.deletedAt || d.jobId !== actor.jobId) return false;
      if (!d.packingSlip && d.folderId !== folder?.id) return false;
      const version = state.versions.find((v) => v.id === d.currentVersionId);
      if (!version || !/^(image\/|application\/pdf$)/.test(version.mimeType))
        return false;
      try {
        return Boolean(folderRole(state, actor, d.folderId));
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
    .map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      currentVersionId: d.currentVersionId,
      packingSlip: d.packingSlip ?? null,
      status: d.packingSlipAnalysis?.applied
        ? "applied"
        : (d.packingSlipAnalysis?.status ?? null),
    }));
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
