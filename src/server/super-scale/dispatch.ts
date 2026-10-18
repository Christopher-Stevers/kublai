import { conversationMessages } from "~/server/db/conversation-schema";
import { publishConversationEvent } from "~/server/conversations/events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "~/server/db";
import { superScaleJobs } from "~/server/db/super-scale-schema";
let running = false;
export async function dispatchSuperScale() {
  if (running) return;
  running = true;
  try {
    const [job] = await db
      .select({ id: superScaleJobs.id, userId: superScaleJobs.userId })
      .from(superScaleJobs)
      .where(inArray(superScaleJobs.status, ["queued", "running"]))
      .orderBy(asc(superScaleJobs.createdAt))
      .limit(1);
    if (!job) return;
    await promisify(execFile)(
      process.execPath,
      [
        "--max-old-space-size=768",
        "--import",
        "tsx",
        path.join(process.cwd(), "src/server/super-scale/worker.ts"),
      ],
      {
        timeout: 15 * 60 * 1000,
        killSignal: "SIGKILL",
        maxBuffer: 65536,
        env: { ...process.env, UV_THREADPOOL_SIZE: "2" },
      },
    );
    const [message] = await db
      .select({ conversationId: conversationMessages.conversationId })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, job.id))
      .limit(1);
    if (message)
      publishConversationEvent({
        conversationId: message.conversationId,
        messageIds: [job.id],
        recipients: [job.userId],
      });
  } finally {
    running = false;
  }
}
