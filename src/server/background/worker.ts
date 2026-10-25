import postgres from "postgres";
import { backgroundScheduler } from "./scheduler";
import { startBackgroundHints } from "./hints";
import { dispatchAndWaitForDetection } from "../rooms/detect-worker-process";
import { dispatchModelConversions } from "../models/conversion";
import { dispatchSuperScale } from "../super-scale/dispatch";
import { dispatchSystemAssessments } from "../job-systems/service";
import { dispatchPackingSlips } from "../packing-slips/service";

if (
  process.env.FOREMANHQ_PROCESS_ROLE !== "worker" ||
  process.env.FOREMANHQ_BACKGROUND_MODE !== "separate"
)
  throw Error("Explicit background service configuration is required");
if (process.argv.includes("--check")) {
  console.log("Background bundle imports verified");
  process.exit(0);
}
// Dedicated connection: losing ownership ends this process before another can claim work.
const lock = postgres(process.env.DATABASE_URL!, {
  max: 1,
  idle_timeout: 0,
  max_lifetime: 0,
  onclose: () => process.exit(1),
});
const held = await lock.reserve();
const [result] = await held`select pg_try_advisory_lock(79153820) as locked`;
if (!result?.locked) throw Error("Another background service owns admission");
await startBackgroundHints();
const scheduler = backgroundScheduler(
  [
    { name: "packing-slips", run: dispatchPackingSlips },
    { name: "assessments", run: () => dispatchSystemAssessments(true) },
    { name: "rooms", run: dispatchAndWaitForDetection },
    { name: "models", run: dispatchModelConversions },
    { name: "super-scale", run: dispatchSuperScale },
  ],
  2,
  (name) => console.warn(`Background ${name} dispatch will retry.`),
);
const timer = setInterval(() => scheduler.tick(), 3000);
const heartbeat = setInterval(() => {
  void held`select 1`.catch(() => process.exit(1));
}, 10_000);
const stop = () => {
  clearInterval(timer);
  clearInterval(heartbeat);
  void scheduler.stop().then(() => process.exit(0));
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
// Notification delivery has its own durable claims and lightweight I/O loop.
const { startChatPushWorker } = await import("../chat/push");
startChatPushWorker();
const { startConversationPushWorker } = await import("../conversations/push");
startConversationPushWorker();
const { startDrawingPushWorker } = await import("../drawings/push-worker");
startDrawingPushWorker();
const { startMaterialPushWorker } =
  await import("../notifications/material-push-worker");
startMaterialPushWorker();
const { cleanupChatAttachments } = await import("../chat/maintenance");
let cleaning = false;
const cleanup = async () => {
  if (cleaning) return;
  cleaning = true;
  try {
    await cleanupChatAttachments();
  } catch {
    console.warn("Attachment cleanup will retry.");
  } finally {
    cleaning = false;
  }
};
setInterval(() => void cleanup(), 3600000).unref();
void cleanup();
scheduler.tick();
console.log("Background service ready: two heavy tasks maximum.");
