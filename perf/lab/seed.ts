import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp, realpath } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import * as s from "../../src/server/db/schema";

const socket = process.env.PERF_LAB_SOCKET;
const url = process.env.PERF_LAB_DATABASE_URL;
const assetRoot = process.env.PERF_LAB_ASSETS;
const output = process.env.PERF_LAB_FIXTURES;
if (
  !socket?.startsWith("/tmp/foremanhq-perf-pg.") ||
  !url ||
  !url.includes(encodeURIComponent(socket)) ||
  !assetRoot?.startsWith(socket + "/") ||
  !output?.startsWith(socket + "/")
)
  throw new Error(
    "Disposable database and storage required; no production defaults",
  );
const conn = postgres({
  host: socket,
  port: 55463,
  database: "foremanhq_perf_lab",
  max: 1,
});
const db = drizzle(conn, { schema: s });
try {
  if (
    (await conn`select current_database() as name`)[0]?.name !==
    "foremanhq_perf_lab"
  )
    throw new Error("Wrong database");
  const id = () => randomUUID();
  const organizationId = id(),
    jobId = id(),
    materialListId = id(),
    quoteId = id();
  const catalogId = id(),
    supplierId = id(),
    orderId = id(),
    orderItemId = id(),
    setId = id();
  const userId = "perf-lab-user";
  const jobName = "Synthetic Harbour Job";
  const materialListName = "Synthetic Rough In";
  await db
    .insert(s.organizations)
    .values({ id: organizationId, name: "Synthetic Performance Company" });
  await db.insert(s.users).values({
    id: userId,
    organizationId,
    name: "Lab Foreman",
    email: "perf-lab@example.invalid",
    role: "admin",
    department: "Plumbing",
    hasOneTimeAccess: true,
    tutorialCompletedAt: new Date(),
    tutorialOutcome: "completed",
  });
  await db.insert(s.jobs).values([
    {
      id: jobId,
      organizationId,
      name: jobName,
      createdByUserId: userId,
      foremanUserId: userId,
      status: "ordered",
    },
    {
      id: id(),
      organizationId,
      name: "Synthetic School Job",
      createdByUserId: userId,
      foremanUserId: userId,
    },
  ]);
  await db
    .insert(s.catalogs)
    .values({ id: catalogId, organizationId, name: "Synthetic Plumbing" });
  await db
    .insert(s.suppliers)
    .values({ id: supplierId, organizationId, name: "Synthetic Supply" });
  const parts = Array.from({ length: 25 }, (_, index) => ({
    id: id(),
    organizationId,
    catalogId,
    displayName: `Synthetic Copper Elbow ${index + 1}`,
    description: "Synthetic fitting for isolated performance tests",
    sortOrder: index,
  }));
  await db.insert(s.partDefinitions).values(parts);
  await db.insert(s.materialLists).values({
    id: materialListId,
    organizationId,
    jobId,
    name: materialListName,
    createdByUserId: userId,
  });
  await db.insert(s.quotes).values({
    id: quoteId,
    organizationId,
    jobId,
    materialListId,
    createdByUserId: userId,
  });
  await db
    .update(s.materialLists)
    .set({ quoteId })
    .where(eq(s.materialLists.id, materialListId));
  await db.insert(s.orders).values({
    id: orderId,
    organizationId,
    jobId,
    materialListId,
    supplierId,
    orderNumber: "LAB-1",
    status: "sent",
    sentVia: "pdf",
    sentAt: new Date(),
    createdByUserId: userId,
  });
  await db.insert(s.orderItems).values({
    id: orderItemId,
    orderId,
    partDefinitionId: parts[0]!.id,
    quantity: "10",
    receivedQuantity: "0",
    descriptionSnapshot: parts[0]!.displayName,
    position: 0,
  });
  await db.insert(s.quoteItems).values(
    parts.map((part, index) => ({
      id: id(),
      quoteId,
      partDefinitionId: part.id,
      quantity: "10",
      descriptionSnapshot: part.displayName,
      addedByUserId: userId,
      ...(index === 0 ? { sentOrderItemId: orderItemId } : {}),
    })),
  );
  await db.insert(s.jobChatMessages).values({
    id: id(),
    jobId,
    authorId: userId,
    clientId: id(),
    requestHash: createHash("sha256").update("fixture").digest("hex"),
    body: "Synthetic welcome message",
  });

  const folder = path.join(assetRoot, "uploads/job-floor-plans", jobId, setId);
  await mkdir(folder, { recursive: true });
  const pdfPath = path.join(folder, "plan.pdf");
  if (process.env.PERF_SYNTHETIC_CACHE_ROOT) {
    const cachedRoot = await realpath(process.env.PERF_SYNTHETIC_CACHE_ROOT);
    if (!cachedRoot.startsWith("/tmp/foremanhq-speed-app-"))
      throw new Error(
        "Only a generated lab snapshot may supply synthetic assets",
      );
    await readFile(path.join(cachedRoot, "PERF_LAB_ONLY"));
    const cached = JSON.parse(
      await readFile(path.join(cachedRoot, "perf/fixtures.json"), "utf8"),
    );
    if (
      cached.provenance !== "isolated-seeded-app" ||
      cached.productionDatabase !== false ||
      cached.userId !== "perf-lab-user"
    )
      throw new Error("Synthetic cached fixture attestation failed");
    const cachedFolder = await realpath(
      path.join(
        cachedRoot,
        "uploads/job-floor-plans",
        cached.jobId,
        cached.setId,
      ),
    );
    if (!cachedFolder.startsWith(cachedRoot + "/uploads/job-floor-plans/"))
      throw new Error("Cached assets escaped generated lab tree");
    await cp(cachedFolder, folder, { recursive: true });
    console.log(
      "Reused only previously generated synthetic 40-page PDF/raster assets; database is freshly seeded.",
    );
  } else {
    const generated = spawnSync(
      process.execPath,
      ["--import", "tsx", "perf/lab/make-set.mts", pdfPath],
      { stdio: "inherit", env: { ...process.env, PAGES: "40" } },
    );
    if (generated.status !== 0)
      throw new Error("Synthetic PDF generation failed");
    // Render the actual fixture, not a placeholder image. This matches the existing PDF path.
    const rendered = spawnSync(
      "pdftoppm",
      ["-scale-to", "1600", "-png", pdfPath, path.join(folder, "preview")],
      { stdio: "inherit" },
    );
    if (rendered.status !== 0)
      throw new Error("Synthetic preview generation failed");
  }
  const document = await PDFDocument.load(await readFile(pdfPath));
  const sheets = [];
  await db.insert(s.jobDrawingSets).values({
    id: setId,
    organizationId,
    jobId,
    name: "Synthetic 40 Sheet Set",
    createdByUserId: userId,
  });
  for (let index = 0; index < 40; index++) {
    const page = index + 1;
    const imagePath = path.join(folder, `floor-${page}.webp`);
    const meta = await sharp(
      path.join(folder, `preview-${String(page).padStart(2, "0")}.png`),
    )
      .webp({ quality: 85 })
      .toFile(imagePath);
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(document, [index]);
    single.addPage(copied!);
    await writeFile(path.join(folder, `page-${page}.pdf`), await single.save());
    const name = `S-${String(page).padStart(3, "0")}`;
    sheets.push({
      id: id(),
      organizationId,
      jobId,
      setId,
      name,
      imageUrl: `/api/job-rooms/files/${jobId}/${setId}/floor-${page}.webp`,
      width: meta.width,
      height: meta.height,
      sortOrder: index,
      sourceFilename: "synthetic-40-pages.pdf",
      uploadedByUserId: userId,
    });
  }
  await db.insert(s.jobDrawingSheets).values(sheets);
  const slipId = id();
  const at = new Date().toISOString();
  // A made-up saved slip; no OCR/model requests, supplier messages, or background jobs.
  await db.insert(s.jobDocumentWorkspaces).values({
    jobId,
    organizationId,
    state: {
      schemaVersion: 1,
      folders: [],
      versions: [],
      comments: [],
      activity: [],
      reviews: [],
      transmittals: [],
      documents: [
        {
          id: slipId,
          jobId,
          folderId: null,
          name: "Synthetic Packing Slip",
          description: "Isolated lab fixture",
          tags: ["packing-slip"],
          status: "draft",
          currentVersionId: null,
          officeWebUrl: null,
          lockedBy: null,
          deletedAt: null,
          createdBy: userId,
          createdAt: at,
          updatedAt: at,
          packingSlip: {
            orderId,
            materialListId,
            orderNumber: "LAB-1",
            materialListName,
          },
        },
      ],
    },
  });
  const fixture = {
    provenance: "isolated-seeded-app",
    productionDatabase: false,
    organizationId,
    userId,
    jobId,
    jobName,
    materialListId,
    materialListName,
    orderId,
    orderItemId,
    sheetName: sheets[0]!.name,
    sheetId: sheets[0]!.id,
    setId,
    slipId,
    assetRoot,
  };
  await writeFile(output, JSON.stringify(fixture, null, 2));
  console.log(
    "Seeded isolated lab: 2 jobs, 25 parts, 1 list/order/slip, chat, 40 synthetic sheets.",
  );
} finally {
  await conn.end();
}
