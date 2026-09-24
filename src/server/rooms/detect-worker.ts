import { failDetectJob, runQueuedDetectJob } from "~/server/rooms/detect-job";

const floorId = process.argv[2];
const method = process.argv[3] === "hybrid" ? "hybrid" : "standard";

if (!floorId) {
  console.error("Room detection worker requires a floor id");
  process.exit(2);
}

void runQueuedDetectJob(floorId, method)
  .then(() => process.exit(0))
  .catch(async (error) => {
    const message =
      error instanceof Error ? error.message : "Room detection worker failed";
    await failDetectJob(floorId, message).catch(() => undefined);
    console.error("[detect-worker]", floorId, message);
    process.exit(1);
  });
