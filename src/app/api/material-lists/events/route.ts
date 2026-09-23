import { createTRPCContext } from "~/server/api/trpc";

import {
  subscribeToOrganizationCatalogueEvents,
  subscribeToOrganizationMaterialListEvents,
  subscribeToOrganizationReplicachePokes,
} from "~/server/material-list-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const { user } = await createTRPCContext({ headers: request.headers });
  const organizationId = user?.organizationId;

  if (!organizationId || (user?.organizationAccessStatus && user.organizationAccessStatus !== "approved")) {
    return new Response("User must belong to an organization", { status: 401 });
  }

  const unsubscribes: Array<() => void> = [];
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
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

      send(
        encodeSse("connected", {
          organizationId,
          connectedAt: new Date().toISOString(),
        }),
      );

      unsubscribes.push(
        subscribeToOrganizationMaterialListEvents(
          organizationId,
          (event) => {
            send(encodeSse("material-list-updated", event));
          },
        ),
        subscribeToOrganizationReplicachePokes(
          organizationId,
          (event) => {
            send(encodeSse("replicache-poke", event));
          },
        ),
        subscribeToOrganizationCatalogueEvents(
          organizationId,
          (event) => {
            send(encodeSse("catalogue-updated", event));
          },
        ),
      );

      keepAlive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, 25_000);
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
