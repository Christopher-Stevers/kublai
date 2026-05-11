import { auth } from "@clerk/nextjs/server";

import { subscribeToOrganizationMaterialListEvents } from "~/server/material-list-events";
import { ensureUser } from "~/server/utils/ensure-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const { userId } = await auth();
  const user = userId ? await ensureUser(userId) : await getDevBypassUser();
  const organizationId = user?.organizationId;

  if (!organizationId) {
    return new Response("User must belong to an organization", { status: 401 });
  }

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          if (keepAlive) clearInterval(keepAlive);
          unsubscribe?.();
        }
      };

      send(
        encodeSse("connected", {
          organizationId,
          connectedAt: new Date().toISOString(),
        }),
      );

      unsubscribe = subscribeToOrganizationMaterialListEvents(
        organizationId,
        (event) => {
          send(encodeSse("material-list-updated", event));
        },
      );

      keepAlive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, 25_000);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      unsubscribe?.();
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
