/** Private local export: no external transfer, immutable reviews and verifiable inputs. */
import "dotenv/config";
import postgres from "postgres";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {
  buildFeedbackExamples,
  buildFeedbackFloor,
  verifyFeedbackFloorSource,
  partitionVerifiedExamples,
  type FeedbackExportEvent,
  type FeedbackExportFloor,
  type FeedbackExportRoom,
} from "../../src/server/rooms/feedback-export";
import {
  JOB_ROOM_FILE_PUBLIC_PREFIX,
  readJobRoomFile,
  getPdfKeyForFloorImage,
  getSourcePageFromFloorImage,
} from "../../src/server/rooms/storage";

const [orgId, destination] = process.argv.slice(2);
if (
  !orgId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    orgId,
  ) ||
  !destination ||
  !path.isAbsolute(destination) ||
  !process.env.DATABASE_URL
)
  throw Error(
    "Usage: export-feedback.ts ORGANIZATION_UUID ABSOLUTE_NEW_OUTPUT_DIRECTORY (with DATABASE_URL)",
  );
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const hashBytes = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const stored = new Set<string>();
async function storeBytes(
  bytes: Buffer,
  kind: "image" | "pdf",
  extension: string,
) {
  const sha256 = hashBytes(bytes),
    relativePath = `${kind}s/${sha256}.${extension}`;
  if (!stored.has(relativePath)) {
    await writeFile(path.join(destination!, relativePath), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    stored.add(relativePath);
  }
  return { path: relativePath, sha256 };
}
try {
  // A new directory is mandatory; stale files cannot masquerade as fresh inputs.
  await mkdir(destination, { mode: 0o700 });
  await mkdir(path.join(destination, "images"), { mode: 0o700 });
  await mkdir(path.join(destination, "pdfs"), { mode: 0o700 });
  const snapshot = await sql.begin(async (tx) => {
    await tx.unsafe(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const events = await tx.unsafe<FeedbackExportEvent[]>(
      'select "roomId","floorId","jobId",decision,"drawingKey","proposalShape","correctedShape",detection,"createdAt" from kublai_room_detection_feedback where "organizationId"=$1 order by "createdAt" desc',
      [orgId],
    );
    const floors = await tx.unsafe<FeedbackExportFloor[]>(
      'select id,"jobId","imageUrl","pageNumber",status,"confirmedAt","completenessReviewedAt" from kublai_job_floor where "organizationId"=$1 and (status=\'confirmed\' or exists(select 1 from kublai_room_detection_feedback f where f."floorId"=kublai_job_floor.id and f."organizationId"=$1))',
      [orgId],
    );
    const rooms = await tx.unsafe<FeedbackExportRoom[]>(
      'select id,"floorId","reviewStatus",shape,detection from kublai_job_room where "organizationId"=$1',
      [orgId],
    );
    return { events, floors, rooms };
  });
  const floors = [];
  for (const floor of snapshot.floors) {
    if (!floor.imageUrl.startsWith(`${JOB_ROOM_FILE_PUBLIC_PREFIX}/`))
      throw Error(`Unsupported private image storage for floor ${floor.id}`);
    const storageKey = floor.imageUrl.slice(
      JOB_ROOM_FILE_PUBLIC_PREFIX.length + 1,
    );
    // A storage URL is data, not permission to read arbitrary local files.
    if (
      !/^[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\/)?floor-\d+\.webp$/i.test(
        storageKey,
      ) ||
      storageKey.split("/")[0] !== floor.jobId
    )
      throw Error(`Invalid private image key for floor ${floor.id}`);
    const imageBytes = await readJobRoomFile(storageKey);
    const dimensions = await sharp(imageBytes).metadata();
    if (!dimensions.width || !dimensions.height)
      throw Error(`Invalid image for floor ${floor.id}`);
    const image = {
      ...(await storeBytes(imageBytes, "image", "webp")),
      width: dimensions.width,
      height: dimensions.height,
      provenance:
        "Native preview generated from the uploaded drawing. It is a display derivative; production evaluation uses the copied PDF.",
    };
    const pdf = await readJobRoomFile(
      getPdfKeyForFloorImage(storageKey, floor.jobId),
    );
    const sourceDrawing = {
      ...(await storeBytes(pdf, "pdf", "pdf")),
      kind: "pdf" as const,
      pageNumber: getSourcePageFromFloorImage(storageKey) ?? floor.pageNumber,
      provenance:
        "Exact local source PDF bytes, privately copied at export time.",
    };
    const result = verifyFeedbackFloorSource(
      buildFeedbackFloor(floor, snapshot.rooms),
      sourceDrawing.sha256,
    );
    floors.push({ ...result, image, sourceDrawing });
  }
  const sourceHashes = new Map(
    floors.map((floor) => [floor.floorId, floor.sourceDrawing.sha256]),
  );
  const snapshots = buildFeedbackExamples(
    snapshot.events,
    snapshot.floors,
    snapshot.rooms,
  );
  const { examples, unverifiedExamples } = partitionVerifiedExamples(
    snapshots,
    sourceHashes,
  );
  await writeFile(
    path.join(destination, "feedback.json"),
    JSON.stringify(
      {
        version: 2,
        target: "physical-spaces",
        exportedAt: new Date().toISOString(),
        organizationId: orgId,
        examples,
        unverifiedExamples,
        floors,
        privacy:
          "Local private copy; no upload. The manifest omits client names, addresses, user identifiers and room names. Copied source drawings retain their original annotations and must remain private.",
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `Exported ${examples.length} verified examples, ${unverifiedExamples.length} excluded unverified review snapshots and ${floors.length} floors privately with job-grouped splits. No external transfer.`,
  );
} finally {
  await sql.end();
}
