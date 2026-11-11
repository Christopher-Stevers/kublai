// Supplemental read-only synthetic item map. Never selects/clicks or changes a row.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fixtureFile = process.env.PERF_LAB_FIXTURES;
const sourceFile = process.env.PERF_QUANTITY_SOURCE_EVIDENCE;
const output = process.env.PERF_QUANTITY_ITEM_PROOF;
const socket = process.env.PERF_LAB_SOCKET;
if (
  !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
  !fs.existsSync(path.join(socket, ".s.PGSQL.55463"))
)
  throw Error("Fresh private socket required");
const url = new URL(process.env.PERF_LAB_DATABASE_URL);
if (
  url.pathname !== "/foremanhq_perf_lab" ||
  url.searchParams.get("host") !== socket ||
  url.searchParams.get("port") !== "55463" ||
  process.env.DATABASE_URL !== process.env.PERF_LAB_DATABASE_URL
)
  throw Error("Private DB URL mismatch");
if (
  !output?.startsWith("/tmp/foremanhq-failed-cells-") ||
  fs.existsSync(output)
)
  throw Error("New owned proof path required");
const fixture = JSON.parse(fs.readFileSync(fixtureFile)),
  source = JSON.parse(fs.readFileSync(sourceFile));
if (
  fixture.provenance !== "isolated-seeded-app" ||
  fixture.productionDatabase !== false ||
  !source.labBuild ||
  !source.sourceBuild ||
  !source.sourceFingerprint
)
  throw Error("Bound synthetic fixture/source required");
const sql = postgres({
  host: socket,
  port: 55463,
  database: "foremanhq_perf_lab",
  max: 1,
  prepare: false,
  ssl: false,
  connect_timeout: 5,
  connection: {
    statement_timeout: 5000,
    application_name: "quantity-office-readonly-preflight",
  },
});
try {
  const result = await sql.begin("read only", async (tx) => {
    const [identity] =
      await tx`select current_database() as database, current_setting('port')::int as port, current_setting('transaction_read_only') as "readOnly"`;
    if (
      identity.database !== "foremanhq_perf_lab" ||
      identity.port !== 55463 ||
      identity.readOnly !== "on"
    )
      throw Error("Read-only private DB identity mismatch");
    const lists =
      await tx`select id,"organizationId","jobId","quoteId" from kublai_material_list where id=${fixture.materialListId}::uuid and "organizationId"=${fixture.organizationId}::uuid and "jobId"=${fixture.jobId}::uuid`;
    if (lists.length !== 1 || !lists[0].quoteId)
      throw Error("Exact seeded list/quote required");
    const rows =
      await tx`select qi.id as "itemId",ml.id as "materialListId",coalesce(pd."displayName",qi."descriptionSnapshot") as "partName",qi.quantity,qi."sentOrderItemId",qi."supplierPartId",qi."supplierId",qi."roomId" from kublai_quote_item qi join kublai_material_list ml on ml."quoteId"=qi."quoteId" left join kublai_part_definition pd on pd.id=qi."partDefinitionId" where ml.id=${fixture.materialListId}::uuid and ml."organizationId"=${fixture.organizationId}::uuid`;
    if (
      rows.length !== 25 ||
      new Set(rows.map((r) => r.itemId)).size !== 25 ||
      new Set(rows.map((r) => r.partName)).size !== 25 ||
      rows.some(
        (r) =>
          !/^Synthetic Copper Elbow ([1-9]|1[0-9]|2[0-5])$/.test(r.partName) ||
          Number(r.quantity) !== 10 ||
          r.supplierPartId ||
          r.supplierId ||
          r.roomId,
      )
    )
      throw Error("Original synthetic item shape mismatch");
    const sent = rows.filter((r) => r.sentOrderItemId),
      eligible = rows.filter((r) => !r.sentOrderItemId);
    if (
      sent.length !== 1 ||
      sent[0].sentOrderItemId !== fixture.orderItemId ||
      eligible.length !== 24
    )
      throw Error("Original sent/ordinary shape mismatch");
    return {
      quoteId: lists[0].quoteId,
      totalItems: rows.length,
      eligibleItems: eligible.map((r) => ({
        itemId: r.itemId,
        materialListId: r.materialListId,
        partName: r.partName,
        quantity: Number(r.quantity),
        sentOrderItemId: null,
      })),
      excludedSentItems: sent.map((r) => ({
        itemId: r.itemId,
        sentOrderItemId: r.sentOrderItemId,
      })),
    };
  });
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        version: 1,
        provenance: "isolated-seeded-app",
        productionDatabase: false,
        sourceBuild: source.sourceBuild,
        sourceFingerprint: source.sourceFingerprint,
        labBuild: source.labBuild,
        materialListId: fixture.materialListId,
        organizationId: fixture.organizationId,
        privateDatabase: {
          socket,
          port: 55463,
          database: "foremanhq_perf_lab",
          readOnly: true,
        },
        ...result,
        sourceEvidenceSha256: sha(sourceFile),
        fixturesSha256: sha(fixtureFile),
        selection:
          "No order or item selected by SQL. Driver must match original first button/input Card's unique h3 against this exact map before binding item ID.",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await sql.end();
}
