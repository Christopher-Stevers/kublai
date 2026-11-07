import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";
type Reader = Pick<typeof db, "execute">;
import { userCan, type PermissionKey } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
import { applyVoiceMaterialMutation } from "~/server/replicache/material-list-sync";
import { assertDocumentAccess, documentActor } from "~/server/documents/access";
import { readWorkspace } from "~/server/documents/service";
import { folderRole } from "~/server/documents/domain";
import { mutationSchema, type VoiceMutation, type VoiceTool } from "./policy";
export function demand(u: RequestUser, p: PermissionKey) {
  if (!userCan(u, p))
    throw Error("Your account does not have permission for that action.");
}
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
// Table/column names are constants in code. Values and tenant IDs are parameters.
export async function record(
  u: RequestUser,
  kind: "job" | "list" | "order" | "part" | "room",
  id: string,
  reader: Reader = db,
) {
  const table = {
    job: "kublai_job",
    list: "kublai_material_list",
    order: "kublai_order",
    part: "kublai_part_definition",
    room: "kublai_job_room",
  }[kind];
  const rows = await reader.execute(
    sql`select * from ${sql.identifier(table)} where id=${id} and "organizationId"=${u.organizationId} limit 1 ${reader !== db ? sql`for update` : sql``}`,
  );
  const row = rows[0];
  if (!row) throw Error("That record is not available in your company.");
  return row;
}
export async function search(
  u: RequestUser,
  t: Extract<VoiceTool, { tool: "search" }>,
) {
  demand(
    u,
    t.kind === "parts"
      ? "tab.catalogue"
      : t.kind === "suppliers"
        ? "tab.suppliers"
        : "tab.dashboard",
  );
  if (t.jobId) await record(u, "job", t.jobId);
  const query =
    t.kind === "orders" ? t.query.replace(/^order\s*#?\s*/i, "") : t.query;
  const q = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  if (t.kind === "documents") {
    if (!t.jobId) throw Error("Choose a job to search its documents.");
    const a = await assertDocumentAccess(u.id, t.jobId);
    const s = await readWorkspace(a);
    const actor = documentActor(a, []);
    return s.documents
      .filter(
        (d) =>
          !d.deletedAt &&
          folderRole(s, actor, d.folderId) &&
          d.name.toLowerCase().includes(t.query.toLowerCase()),
      )
      .slice(0, 25)
      .map((d) => ({
        id: d.id,
        name: d.name,
        jobId: d.jobId,
        order: d.packingSlip?.orderNumber,
      }));
  }
  if (t.kind === "drawings") {
    demand(u, "drawings.view");
    if (!t.jobId) throw Error("Choose a job to open its drawings.");
    return [
      ...(await db.execute(
        sql`select id,name,"setId","jobId" from kublai_job_drawing_sheet where "organizationId"=${u.organizationId} and "jobId"=${t.jobId} and "documentVersionId" is null and name ilike ${q} order by name limit 25`,
      )),
    ];
  }
  if (t.kind === "parts")
    return [
      ...(await db.execute(
        sql`select id,"displayName" as name,left(description,500) as description,"piecesPerPack","individualUnit","bulkUnit" from kublai_part_definition where "organizationId"=${u.organizationId} and ("displayName" ilike ${q} or description ilike ${q}) order by "displayName" limit 25`,
      )),
    ];
  if (t.kind === "suppliers")
    return [
      ...(await db.execute(
        sql`select id,name from kublai_supplier where "organizationId"=${u.organizationId} and name ilike ${q} order by name limit 25`,
      )),
    ];
  const table = {
    jobs: "kublai_job",
    lists: "kublai_material_list",
    orders: "kublai_order",
    rooms: "kublai_job_room",
  }[t.kind];
  const name = t.kind === "orders" ? "orderNumber" : "name";
  return [
    ...(await db.execute(
      sql`select id,${sql.identifier(name)} as name ${t.kind !== "jobs" ? sql`, "jobId"` : sql``} from ${sql.identifier(table)} where "organizationId"=${u.organizationId} and ${sql.identifier(name)} ilike ${q} ${t.jobId && t.kind !== "jobs" ? sql`and "jobId"=${t.jobId}` : sql``} order by ${sql.identifier(name)} limit 25`,
    )),
  ];
}
export async function inspect(
  u: RequestUser,
  kind: "order" | "list",
  id: string,
) {
  demand(u, "tab.dashboard");
  const r = await record(u, kind, id);
  if (kind === "order") {
    const items = [
      ...(await db.execute(
        sql`select id,"descriptionSnapshot" as name,quantity,"receivedQuantity","verificationStatus",count(*) over() as "totalCount" from kublai_order_item where "orderId"=${id} order by id limit 100`,
      )),
    ];
    return {
      id,
      name: r.orderNumber,
      jobId: r.jobId,
      status: r.status,
      notes: r.notes,
      totalItems: Number(items[0]?.totalCount ?? 0),
      items,
    };
  }
  const items = [
    ...(await db.execute(
      sql`select id,"descriptionSnapshot" as name,quantity,"partDefinitionId" as "partId","roomId","sentOrderItemId",count(*) over() as "totalCount" from kublai_quote_item where "quoteId"=${r.quoteId as string} order by id limit 100`,
    )),
  ];
  return {
    id,
    name: r.name,
    jobId: r.jobId,
    totalItems: Number(items[0]?.totalCount ?? 0),
    items,
  };
}

const globalPages: Record<string, { path: string; permission: PermissionKey }> =
  {
    jobs: { path: "/jobs", permission: "tab.dashboard" },
    settings: { path: "/jobs/account/settings", permission: "tab.dashboard" },
    account: { path: "/jobs/account", permission: "tab.dashboard" },
    catalogue: { path: "/jobs/catalogue", permission: "tab.catalogue" },
    suppliers: { path: "/jobs/suppliers", permission: "tab.suppliers" },
    quotes: { path: "/jobs/quotes", permission: "tab.quotes" },
    orders: { path: "/jobs/orders", permission: "tab.orders" },
    draws: { path: "/jobs/draws", permission: "tab.draws" },
    estimating: { path: "/jobs/estimating", permission: "tab.estimating" },
    timesheets: { path: "/jobs/timesheets", permission: "tab.timesheets" },
    assets: { path: "/jobs/assets", permission: "tab.assets" },
    organization: {
      path: "/jobs/organization",
      permission: "tab.organization",
    },
    chat: { path: "/jobs/chat", permission: "tab.chat" },
  };
export async function navigate(
  u: RequestUser,
  t: Extract<VoiceTool, { tool: "navigate" }>,
) {
  const g = globalPages[t.destination];
  if (g) {
    demand(u, g.permission);
    return g.path;
  }
  if (t.destination.startsWith("asset-")) {
    demand(u, "tab.assets");
    return `/jobs/assets/${t.destination.slice(6)}`;
  }
  demand(u, "tab.dashboard");
  if (t.destination === "drawing") {
    demand(u, "drawings.view");
    if (!t.id) throw Error("Choose a drawing first.");
    const [sheet] = await db.execute(
      sql`select id,"jobId","setId" from kublai_job_drawing_sheet where id=${t.id} and "organizationId"=${u.organizationId} and "documentVersionId" is null`,
    );
    if (!sheet) throw Error("Drawing not available.");
    return `/jobs/${String(sheet.jobId)}/drawings?drawingSheet=${String(sheet.id)}&drawingSet=${String(sheet.setId)}`;
  }
  if (t.destination === "material-list") {
    if (!t.id) throw Error("Choose a material list first.");
    await record(u, "list", t.id);
    return `/jobs/material-lists/${t.id}`;
  }
  if (!t.jobId) throw Error("Which job should I open?");
  await record(u, "job", t.jobId);
  if (t.destination === "systems") demand(u, "systems.access");
  if (t.destination === "drawings") demand(u, "drawings.view");
  if (t.destination === "receiving") demand(u, "orders.receive");
  return `/jobs/${t.jobId}${t.destination === "job" ? "" : "/" + (t.destination === "job-chat" ? "chat" : t.destination)}`;
}
export async function prepareChange(
  u: RequestUser,
  input: VoiceMutation,
  reader: Reader = db,
) {
  const c = mutationSchema.parse(input);
  demand(u, "tab.dashboard");
  demand(
    u,
    c.action === "createJob"
      ? "jobs.create"
      : c.action === "renameJob"
        ? "jobs.edit"
        : c.action === "appendOrderNote"
          ? "orders.receive"
          : "lists.edit",
  );
  let before: unknown = null;
  let summary = "";
  if (c.action === "createJob") summary = `Create job “${c.name}”.`;
  else if (c.action === "renameJob") {
    const r = await record(u, "job", c.jobId, reader);
    before = r;
    summary = `Rename job “${String(r.name)}” to “${c.name}”.`;
  } else if (c.action === "createMaterialList") {
    const r = await record(u, "job", c.jobId, reader);
    before = r;
    if (c.roomId) {
      const room = await record(u, "room", c.roomId, reader);
      if (room.jobId !== c.jobId) throw Error("Room belongs to another job.");
      before = { r, room };
    }
    summary = `Create material list “${c.name}” in “${String(r.name)}”.`;
  } else if (c.action === "appendOrderNote") {
    const r = await record(u, "order", c.orderId, reader);
    before = r;
    summary = `Append note to ${String(r.orderNumber)}: ${c.note}`;
  } else {
    const list = await record(u, "list", c.materialListId, reader);
    before = list;
    if (c.action === "renameMaterialList")
      summary = `Rename “${String(list.name)}” to “${c.name}”.`;
    if (c.action === "addItem") {
      const part = await record(u, "part", c.partId, reader);
      before = { list, part };
      let roomName = "";
      if (c.roomId) {
        const room = await record(u, "room", c.roomId, reader);
        if (room.jobId !== list.jobId)
          throw Error("Room belongs to another job.");
        before = { list, part, room };
        roomName = ` for ${String(room.name)}`;
      }
      const unit =
        Number(part.piecesPerPack) > 1
          ? typeof part.bulkUnit === "string"
            ? part.bulkUnit
            : "packs"
          : typeof part.individualUnit === "string"
            ? part.individualUnit
            : "units";
      summary = `Add ${c.quantity} ${unit} of “${String(part.displayName)}” to “${String(list.name)}”${roomName}.`;
    }
    if (c.action === "setQuantity") {
      const rows = await reader.execute(
        sql`select * from kublai_quote_item where id=${c.itemId} and "quoteId"=${list.quoteId as string} ${reader !== db ? sql`for update` : sql``}`,
      );
      const item = rows[0];
      if (!item) throw Error("Item is not in that list.");
      if (item.sentOrderItemId)
        throw Error("Already ordered items cannot be changed by voice.");
      before = { list, item };
      summary = `Change “${typeof item.descriptionSnapshot === "string" ? item.descriptionSnapshot : "item"}” from ${String(item.quantity)} to ${c.quantity} in “${String(list.name)}”.`;
    }
  }
  return { summary, fingerprint: hash(before) };
}
export async function executeChange(
  u: RequestUser,
  c: VoiceMutation,
  fingerprint: string,
) {
  const fresh = await prepareChange(u, c);
  const check = async (reader: Reader) => {
    const now = await prepareChange(u, c, reader);
    if (now.fingerprint !== fingerprint)
      throw Error(
        "This record changed since the preview. Ask again for a fresh preview.",
      );
  };
  const apply = (
    name: Parameters<typeof applyVoiceMaterialMutation>[1],
    args: unknown,
  ) => applyVoiceMaterialMutation(u, name, args, check);
  // No caller-supplied mutation name or additional fields can reach the dispatcher.
  switch (c.action) {
    case "createJob":
      await apply("createJob", {
        jobId: randomUUID(),
        name: c.name,
      });
      break;
    case "renameJob":
      await apply("updateJob", {
        jobId: c.jobId,
        name: c.name,
      });
      break;
    case "createMaterialList":
      await apply("createMaterialList", {
        materialListId: randomUUID(),
        jobId: c.jobId,
        name: c.name,
        roomId: c.roomId,
      });
      break;
    case "renameMaterialList":
      await apply("renameMaterialList", {
        materialListId: c.materialListId,
        name: c.name,
      });
      break;
    case "addItem":
      await apply("addItem", {
        itemId: randomUUID(),
        materialListId: c.materialListId,
        partDefinitionId: c.partId,
        quantity: c.quantity,
        roomId: c.roomId,
        useJobDefaults: true,
        descriptionSnapshot: String(
          (await record(u, "part", c.partId)).displayName,
        ),
      });
      break;
    case "setQuantity":
      await apply("updateItemQuantity", {
        materialListId: c.materialListId,
        itemId: c.itemId,
        quantity: c.quantity,
      });
      break;
    case "appendOrderNote":
      await db.transaction(async (tx) => {
        await check(tx);
        await tx.execute(
          sql`update kublai_order set notes=concat_ws(E'\n',nullif(notes,''),${c.note}) where id=${c.orderId} and "organizationId"=${u.organizationId}`,
        );
      });
      break;
  }
  return "Saved. " + fresh.summary;
}
