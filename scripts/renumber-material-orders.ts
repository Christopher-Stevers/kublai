/** Dry run by default. Apply requires an explicit org and private backup path.
 * Usage: pnpm exec tsx scripts/renumber-material-orders.ts --org UUID [--apply --backup /path/file.json]
 */
import dotenv from "dotenv";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { planOrderRenumbering, renumberDocumentLinks } from "../src/server/order-renumbering";
import type { DocumentState } from "../src/server/documents/types";

dotenv.config({quiet: true});
const args = process.argv.slice(2);
const org = args[args.indexOf("--org") + 1];
const apply = args.includes("--apply");
const backup = args[args.indexOf("--backup") + 1];
if (!args.includes("--org") || !/^[0-9a-f-]{36}$/i.test(org ?? "")) throw Error("An explicit organization UUID is required");
if (apply && (!args.includes("--backup") || !backup?.startsWith("/"))) throw Error("An absolute backup file is required");
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
const db = postgres(process.env.DATABASE_URL, {max: 1});
try {
  await db.begin(async tx => {
    await tx`set local lock_timeout = '10s'`;
    await tx`set local statement_timeout = '90s'`;
    const [organization] = await tx`select id,name from kublai_organization where id=${org}`;
    if (!organization) throw Error("Organization not found");
    const jobs = await tx`select id from kublai_job where "organizationId"=${org} order by id`;
    // Same lock order as receiving: document workspace, then order allocation.
    for (const job of jobs) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${job.id},4149))`;
      await tx`select pg_advisory_xact_lock(hashtext(${`${org}:${job.id}:orders`}))`;
    }
    const orders = await tx`select o.*,s.name as "supplierName" from kublai_order o
      left join kublai_supplier s on s.id=o."supplierId" and s."organizationId"=o."organizationId"
      where o."organizationId"=${org} and o.kind='materials' order by o.id for update of o`;
    const workspaces = await tx`select * from kublai_job_document_workspace where "organizationId"=${org} for update`;
    const plan = planOrderRenumbering(orders as unknown as Parameters<typeof planOrderRenumbering>[0]);
    const changes = plan.filter(row => row.before !== row.after);
    const now = new Date().toISOString();
    const snapshots = JSON.parse(JSON.stringify(workspaces));
    const aliases = new Map<string, Set<string>>();
    for (const order of orders) aliases.set(order.id, new Set(order.previousOrderNumbers ?? []));
    for (const change of changes) if (change.before) aliases.get(change.id)!.add(change.before);
    for (const workspace of workspaces) for (const doc of (workspace.state as DocumentState).documents) {
      if (doc.packingSlip) {
        const target = plan.find(row => row.id === doc.packingSlip!.orderId);
        if (target && doc.packingSlip.orderNumber !== target.after)
          aliases.get(target.id)!.add(doc.packingSlip.orderNumber);
      }
    }
    let documents = 0;
    for (const workspace of workspaces) documents += renumberDocumentLinks(workspace.state, plan.filter(row => row.jobId === workspace.jobId), now);
    console.log(JSON.stringify({mode: apply ? "apply" : "dry-run", organization, orders: orders.length,
      changedOrders: changes.length, changedDocuments: documents, plan}, null, 2));
    if (!apply) return;
    await mkdir(dirname(backup!), {recursive:true,mode:0o700});
    await writeFile(backup!, JSON.stringify({organization,at:now,orders,workspaces:snapshots,plan},null,2), {flag:"wx",mode:0o600});
    const tag = "0101_order_reference_history";
    const source = await readFile(new URL(`../drizzle/${tag}.sql`,import.meta.url),"utf8");
    const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json",import.meta.url),"utf8"));
    const when = journal.entries.find((e: {tag:string}) => e.tag === tag).when;
    const hash = createHash("sha256").update(source).digest("hex");
    await tx`select pg_advisory_xact_lock(72491834)`;
    const existing = await tx`select hash from drizzle.__drizzle_migrations where created_at=${when}`;
    if (existing.some(row => row.hash !== hash)) throw Error("Migration checksum mismatch");
    await tx.unsafe(source);
    if (!existing.length) await tx`insert into drizzle.__drizzle_migrations (hash,created_at) values (${hash},${when})`;
    // Temporary unique references let swaps satisfy the existing unique index.
    for (const change of changes) await tx`update kublai_order set "orderNumber"=${`renumber-${change.id}`} where id=${change.id} and "organizationId"=${org}`;
    for (const row of plan) {
      const history = [...aliases.get(row.id)!].filter(ref => ref !== row.after);
      await tx`update kublai_order set "orderNumber"=${row.after}, "previousOrderNumbers"=${tx.json(history)} where id=${row.id} and "organizationId"=${org}`;
    }
    for (const workspace of workspaces) {
      const before = snapshots.find((row: {jobId:string}) => row.jobId === workspace.jobId);
      if (JSON.stringify(before.state) !== JSON.stringify(workspace.state))
        await tx`update kublai_job_document_workspace set state=${tx.json(workspace.state)}, revision=revision+1,"updatedAt"=${now} where "jobId"=${workspace.jobId} and "organizationId"=${org}`;
    }
    // Bump list timestamps so clients that sync incrementally refresh order labels.
    await tx`update kublai_material_list set "updatedAt"=${now} where "organizationId"=${org} and id in (select "materialListId" from kublai_order where "organizationId"=${org} and kind='materials')`;
    const stored = await tx`select id,"orderNumber" from kublai_order where "organizationId"=${org} and kind='materials'`;
    if (stored.length !== plan.length || stored.some(row => plan.find(p => p.id === row.id)?.after !== row.orderNumber)) throw Error("Renumber verification failed");
    console.log(`Verified ${stored.length} orders; backup: ${backup}`);
  });
} finally { await db.end(); }
