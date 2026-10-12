import { TRPCError } from "@trpc/server";
import {
  conversationEventSnapshot,
  subscribeConversationEvents,
  type ConversationEvent,
} from "~/server/conversations/events";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shared = globalThis as unknown as {
  __conversationStreams?: {
    closers: Set<() => void>;
    users: Map<string, number>;
  };
};
const streams = (shared.__conversationStreams ??= {
  closers: new Set(),
  users: new Map(),
});
if (!Reflect.get(streams, "signals")) {
  Reflect.set(streams, "signals", true);
  const stop = () => {
    for (const close of [...streams.closers]) close();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

export async function GET(request: Request) {
  const { userId } = await getRequestIdentity(request.headers, { request });
  let previous: Map<string, string>;
  try {
    previous = await conversationEventSnapshot(userId ?? "");
  } catch (error) {
    return new Response("Chat unavailable", {
      status:
        error instanceof TRPCError && error.code === "UNAUTHORIZED" ? 401 : 403,
    });
  }
  const user = userId!;
  if ((streams.users.get(user) ?? 0) >= 5)
    return new Response("Too many connections", { status: 429 });
  streams.users.set(user, (streams.users.get(user) ?? 0) + 1);
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let coalesce: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let close = () => {
    /* Initialized when the stream starts. */
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeat);
    clearTimeout(coalesce);
    clearTimeout(expiry);
    unsubscribe?.();
    request.signal.removeEventListener("abort", close);
    streams.closers.delete(close);
    const remaining = (streams.users.get(user) ?? 1) - 1;
    if (remaining > 0) streams.users.set(user, remaining);
    else streams.users.delete(user);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
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
      streams.closers.add(close);
      request.signal.addEventListener("abort", close, { once: true });
      let polling = false,
        rerun = false;
      let pending: ConversationEvent[] = [];
      const poll = async () => {
        if (closed) return;
        if (polling) {
          rerun = true;
          return;
        }
        polling = true;
        pending = [];
        try {
          const next = await conversationEventSnapshot(user);
          if (closed) return;
          const changes = [...next]
            .filter(([id, stamp]) => previous.get(id) !== stamp)
            .map(([id]) => {
              return {
                conversationId: id,
                // A snapshot can include a simultaneous commit from another process.
                // Refresh loaded history instead of assuming local hints are complete.
                messageIds: null,
              };
            });
          const removed = [...previous.keys()].filter((id) => !next.has(id));
          previous = next;
          if (changes.length || removed.length)
            send(
              `event: conversations-updated\ndata: ${JSON.stringify({ changes, removed })}\n\n`,
            );
        } catch {
          close();
        } finally {
          polling = false;
          if (rerun || pending.length) {
            rerun = false;
            void poll();
          }
        }
      };
      unsubscribe = subscribeConversationEvents((event) => {
        if (event.recipients && !event.recipients.includes(user)) return;
        if (!event.recipients && !previous.has(event.conversationId)) return;
        // Bounded hints: fall back to a full refresh during a burst.
        if (pending.length < 100) pending.push(event);
        coalesce ??= setTimeout(() => {
          coalesce = undefined;
          void poll();
        }, 50);
      });
      send("retry: 3000\nevent: connected\ndata: {}\n\n");
      // Close the initial snapshot/subscription race, and recover cross-process events.
      void poll();
      pollTimer = setInterval(() => {
        void poll();
      }, 30000);
      heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
      expiry = setTimeout(close, 4 * 60 * 1000);
      if (request.signal.aborted) close();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
