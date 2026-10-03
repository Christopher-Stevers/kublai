import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/server/db";
import { jobChatEvents } from "~/server/db/schema";
import { assertChatAccess } from "~/server/chat/access";
import { subscribeChatEvents } from "~/server/chat/events";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shared = globalThis as unknown as {
  __chatStreams?: { closers: Set<() => void>; perUser: Map<string, number> };
};
const streams = (shared.__chatStreams ??= {
  closers: new Set(),
  perUser: new Map(),
});
if (streams.closers.size === 0 && !Reflect.get(streams, "signals")) {
  Reflect.set(streams, "signals", true);
  // Cooperate with Next's own handlers; never remove them or call process.exit.
  const stop = () => {
    for (const close of [...streams.closers]) close();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!z.uuid().safeParse(jobId).success)
    return new Response("Invalid job", { status: 400 });
  let cursor = Number(
    request.headers.get("last-event-id") ??
      new URL(request.url).searchParams.get("after") ??
      0,
  );
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    return new Response("Invalid cursor", { status: 400 });
  const { userId } = await getRequestIdentity(request.headers);
  try {
    await assertChatAccess(userId, jobId!);
  } catch (error) {
    return new Response("Chat unavailable", {
      status:
        error instanceof TRPCError && error.code === "UNAUTHORIZED" ? 401 : 403,
    });
  }
  if ((streams.perUser.get(userId!) ?? 0) >= 5)
    return new Response("Too many connections", { status: 429 });
  streams.perUser.set(userId!, (streams.perUser.get(userId!) ?? 0) + 1);
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let close: () => void = () => undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearTimeout(expiry);
    unsubscribe?.();
    request.signal.removeEventListener("abort", close);
    streams.closers.delete(close);
    const remaining = (streams.perUser.get(userId!) ?? 1) - 1;
    if (remaining > 0) streams.perUser.set(userId!, remaining);
    else streams.perUser.delete(userId!);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* Already closed. */
        }
      };
      streams.closers.add(close);
      request.signal.addEventListener("abort", close, { once: true });
      const send = (chunk: string) => {
        if (closed || request.signal.aborted) {
          close();
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      let polling = false;
      const poll = async () => {
        if (polling || closed) return;
        polling = true;
        try {
          await assertChatAccess(userId, jobId!);
          const rows = (await db
            .select({
              sequence: jobChatEvents.sequence,
              messageId: jobChatEvents.messageId,
              type: jobChatEvents.type,
            })
            .from(jobChatEvents)
            .where(
              and(
                eq(jobChatEvents.jobId, jobId!),
                gt(jobChatEvents.sequence, cursor),
              ),
            )
            .orderBy(asc(jobChatEvents.sequence))
            .limit(250)) as {
            sequence: number;
            messageId: string;
            type: string;
          }[];
          if (rows.length) {
            cursor = rows.at(-1)!.sequence;
            send(
              `id: ${cursor}\nevent: chat-updated\ndata: ${JSON.stringify({ jobId, sequence: cursor, changes: rows })}\n\n`,
            );
          } else send(`: keepalive ${Date.now()}\n\n`);
        } catch {
          close();
        } finally {
          polling = false;
        }
      };
      unsubscribe = subscribeChatEvents(jobId!, () => {
        void poll();
      });
      send(
        `retry: 3000\nevent: connected\ndata: ${JSON.stringify({ jobId })}\n\n`,
      );
      void poll();
      interval = setInterval(() => {
        void poll();
      }, 5000);
      expiry = setTimeout(close, 4 * 60 * 1000);
      if (request.signal.aborted) close();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
