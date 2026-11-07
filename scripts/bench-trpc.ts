/**
 * Read-only latency benchmark for the slowest tRPC queries.
 * Calls procedures in-process as an existing managing user and reports
 * wall time and database round trips per call.
 *
 *   node --import dotenv/config --import tsx --import ./scripts/bench/register-stubs.mjs \
 *     scripts/bench-trpc.ts [--runs 3]
 *
 * Only query procedures are called; nothing is written.
 */
import { isNotNull } from "drizzle-orm";

import { appRouter } from "~/server/api/root";
import { getUserPermissions } from "~/server/auth/permissions";
import { db } from "~/server/db";
import { withQueryStats } from "~/server/db/query-stats";
import { users } from "~/server/db/schema";

const runsArg = process.argv.indexOf("--runs");
const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 3;

const candidates = await db
  .select()
  .from(users)
  .where(isNotNull(users.organizationId));
const user = candidates.find(
  (candidate) => getUserPermissions(candidate).isManagingAccount,
);
if (!user) throw new Error("No managing user with an organization");

const caller = appRouter.createCaller({
  db,
  userId: user.id,
  user,
  headers: new Headers(),
} as never);

type Case = [string, () => Promise<unknown>];
const firstSupplier = (await caller.supplier.list()) as Array<{ id: string }>;
const firstPart = (await caller.catalogue.searchParts({ limit: 1 })) as Array<{
  id: string;
}>;

const cases: Case[] = [
  ["catalogue.getPartWizardSummary", () => caller.catalogue.getPartWizardSummary({ grouped: true })],
  ["catalogue.searchParts(q)", () => caller.catalogue.searchParts({ query: "elbow", limit: 200 })],
  ["catalogue.getCategoryTree", () => caller.catalogue.getCategoryTree()],
  ["catalogue.getCatalogs", () => caller.catalogue.getCatalogs()],
  ["materialList.listOrders", () => caller.materialList.listOrders()],
  ["materialList.listQuotes", () => caller.materialList.listQuotes()],
  ["organization.getOrganizationSettings", () => caller.organization.getOrganizationSettings()],
  ["supplier.list", () => caller.supplier.list()],
  ["draws.listJobs", () => caller.draws.listJobs()],
];
if (firstSupplier[0]) {
  cases.push(["supplier.getById", () => caller.supplier.getById({ id: firstSupplier[0]!.id })]);
}
if (firstPart[0]) {
  cases.push(["catalogue.getPart", () => caller.catalogue.getPart({ partId: firstPart[0]!.id })]);
}

console.log("procedure".padEnd(40) + "best ms".padStart(9) + "worst ms".padStart(10) + "queries".padStart(9));
for (const [name, run] of cases) {
  const times: number[] = [];
  let queries = 0;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const { stats } = await withQueryStats(run);
    times.push(performance.now() - start);
    queries = stats.count;
  }
  console.log(
    name.padEnd(40) +
      Math.min(...times).toFixed(0).padStart(9) +
      Math.max(...times).toFixed(0).padStart(10) +
      String(queries).padStart(9),
  );
}
process.exit(0);
