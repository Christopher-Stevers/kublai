import { subscribeToMaterialListEvents } from "~/server/material-list-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const { id } = await params;
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

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        send(encodeSse("error", { message: "Invalid material list id" }));
        closed = true;
        controller.close();
        return;
      }

      send(encodeSse("connected", { materialListId: id, connectedAt: new Date().toISOString() }));

      unsubscribe = subscribeToMaterialListEvents(id, (event) => {
        send(encodeSse("material-list-updated", event));
      });

      keepAlive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, 25000);
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
