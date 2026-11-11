import fs from "node:fs";
import postgres from "postgres";
const url = new URL(process.env.PERF_LAB_DATABASE_URL ?? "http://invalid");
const socket = url.searchParams.get("host");
if (
  url.pathname !== "/foremanhq_perf_lab" ||
  !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
  !fs.existsSync(`${socket}/.s.PGSQL.55463`)
)
  throw new Error("Private disposable lab database required");
const fixture = JSON.parse(fs.readFileSync(process.env.PERF_LAB_FIXTURES));
if (
  fixture.provenance !== "isolated-seeded-app" ||
  fixture.productionDatabase !== false ||
  fixture.userId !== "perf-lab-user"
)
  throw new Error("Seeded fixture attestation required");
const sql = postgres({
  host: socket,
  port: 55463,
  database: "foremanhq_perf_lab",
  max: 1,
});
try {
  await sql.begin(async (tx) => {
    await tx`update kublai_quote_item set quantity='10' where quote_id in (select id from kublai_quote where material_list_id=${fixture.materialListId})`;
    await tx`update kublai_order_item set received_quantity='0', verification_status='pending' where order_id=${fixture.orderId}`;
    await tx`delete from kublai_job_chat_message where job_id=${fixture.jobId} and body like 'Synthetic speed lab message %'`;
  });
  console.log(
    "Reset only synthetic quantity, receipt and lab chat writes before independent capture.",
  );
} finally {
  await sql.end();
}
