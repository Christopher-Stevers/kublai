import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { materialLists } from "~/server/db/schema";
import { subscribeToMaterialListEvents } from "~/server/material-list-events";
import { ensureUser } from "~/server/utils/ensure-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return new Response("Invalid material list id", { status: 400 });
  }

  const { userId } = await auth();
  const user = userId ? await ensureUser(userId) : await getDevBypassUser();
  const organizationId = user?.organizationId;

  if (!organizationId) {
    return new Response("User must belong to an organization", { status: 401 });
  }

  const [materialList] = await db
    .select({ id: materialLists.id })
    .from(materialLists)
    .where(
      and(
        eq(materialLists.id, id),
        eq(materialLists.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!materialList) {
    return new Response("Material list not found", { status: 404 });
  }

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const closeStream = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // The browser may have already closed the EventSource connection.
        }
      };
      const send = (chunk: string) => {
        if (closed || request.signal.aborted) {
          closeStream();
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      request.signal.addEventListener("abort", closeStream, { once: true });

      send(encodeSse("connected", { materialListId: id, connectedAt: new Date().toISOString() }));

      unsubscribe = subscribeToMaterialListEvents(id, (event) => {
        send(encodeSse("material-list-updated", event));
      });

      keepAlive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, 25000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
