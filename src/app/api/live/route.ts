import { subscribeMaterialSortEvents } from "~/server/live/material-sort-events";
import { createTRPCContext } from "~/server/api/trpc";
import { GET as materialSource } from "~/app/api/material-lists/events/route";
import { GET as conversationSource } from "~/app/api/conversations/events/route";
import { GET as chatSource } from "~/app/api/job-chat/events/route";
import { liveHub } from "~/server/live/hub";
import { frameParser, sourceHint } from "~/server/live/frames";
import { liveHint, liveAccountScope } from "~/lib/live-protocol";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const connections = new Map<string, number>();
/** One browser transport, using the existing authoritative/authorized sources.
 * Their DB polling stays until all web/worker producer hints are proven. */
export async function GET(request: Request) {
  const url = new URL(request.url),
    jobs = (url.searchParams.get("jobs") ?? "").split(",").filter(Boolean),
    includeConversations = url.searchParams.get("conversations") === "1",
    includePreferences = url.searchParams.get("preferences") === "1";
  if (
    jobs.length > 20 ||
    jobs.some((value) => {
      const parts = value.split(":"),
        [id, cursor] = parts;
      return (
        parts.length > 2 ||
        !UUID.test(id ?? "") ||
        !/^\d{1,16}$/.test(cursor ?? "0") ||
        !Number.isSafeInteger(Number(cursor ?? 0))
      );
    })
  )
    return new Response("Invalid live topics", { status: 400 });
  const identity = await createTRPCContext({
      headers: request.headers,
      request,
    }),
    user = identity.user;
  if (
    !user?.organizationId ||
    (user.organizationAccessStatus &&
      user.organizationAccessStatus !== "approved")
  )
    return new Response("Sign in required", { status: 401 });
  const scope = liveAccountScope(
    user.organizationId,
    user.id,
    identity.simulation?.id,
  );
  if ((connections.get(scope) ?? 0) >= 5)
    return new Response("Too many connections", { status: 429 });
  if (request.signal.aborted) return new Response(null, { status: 499 });
  connections.set(scope, (connections.get(scope) ?? 0) + 1);
  let reserved = true;
  const releaseConnection = () => {
    if (!reserved) return;
    reserved = false;
    const count = (connections.get(scope) ?? 1) - 1;
    if (count > 0) connections.set(scope, count);
    else connections.delete(scope);
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const headers = new Headers(request.headers);
  headers.delete("last-event-id");
  const child = (pathname: string) =>
    new Request(new URL(pathname, url.origin), {
      headers,
      signal: controller.signal,
    });
  const responses: Response[] = [];
  try {
    responses.push(await materialSource(child("/api/material-lists/events")));
    if (includeConversations)
      responses.push(
        await conversationSource(child("/api/conversations/events")),
      );
    for (const value of new Set(jobs)) {
      const [id, after = "0"] = value.split(":");
      responses.push(
        await chatSource(
          child(`/api/job-chat/events?jobId=${id}&after=${after}`),
        ),
      );
    }
    const failed = responses.find(
      (response) =>
        !response.ok ||
        !response.headers.get("content-type")?.includes("text/event-stream"),
    );
    if (failed) {
      controller.abort();
      releaseConnection();
      request.signal.removeEventListener("abort", abort);
      return new Response("Live topic unavailable", {
        status: failed.status >= 400 ? failed.status : 503,
      });
    }
  } catch {
    controller.abort();
    releaseConnection();
    request.signal.removeEventListener("abort", abort);
    return new Response("Live unavailable", { status: 503 });
  }
  if (request.signal.aborted) {
    controller.abort();
    releaseConnection();
    request.signal.removeEventListener("abort", abort);
    return new Response(null, { status: 499 });
  }
  const jobIds = new Set(jobs.map((value) => value.split(":")[0]));
  let closed = false,
    heartbeat: ReturnType<typeof setInterval>,
    expiry: ReturnType<typeof setTimeout>;
  let unsubscribe: () => void = () => undefined;
  let unsubscribePreferences: () => void = () => undefined;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const cleanup = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    clearInterval(heartbeat);
    clearTimeout(expiry);
    unsubscribe();
    unsubscribePreferences();
    request.signal.removeEventListener("abort", abort);
    releaseConnection();
    for (const reader of readers) void reader.cancel().catch(() => undefined);
  };
  const body = new ReadableStream<Uint8Array>({
    start(output) {
      const encoder = new TextEncoder();
      const close = () => {
        cleanup();
        try {
          output.close();
        } catch {}
      };
      const send = (text: string) => {
        if (closed) return;
        if ((output.desiredSize ?? 0) < -64) {
          close();
          return;
        }
        try {
          output.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      controller.signal.addEventListener("abort", close, { once: true });
      const allowed = (topic: string, key?: string) =>
        topic === "conversations"
          ? includeConversations
          : topic === "chat"
            ? jobIds.has(key)
            : topic === "preferences"
              ? includePreferences
              : true;
      const emit = (frame: ReturnType<typeof liveHub.publish>) => {
        if (frame.scope === scope && allowed(frame.hint.topic, frame.hint.key))
          send(
            `id: ${frame.id}\nevent: live\ndata: ${JSON.stringify(frame.hint)}\n\n`,
          );
      };
      unsubscribe = liveHub.subscribe(emit);
      if (includePreferences)
        unsubscribePreferences = subscribeMaterialSortEvents(
          { organizationId: user.organizationId!, userId: user.id },
          (kind, revision) => {
            if (!closed)
              liveHub.publish(scope, { topic: "preferences", kind }, revision);
          },
        );
      const resume = liveHub.resume(
        scope,
        request.headers.get("last-event-id") ?? url.searchParams.get("after"),
      );
      // Large reconnect gaps use one authoritative resync, not an unbounded replay
      // burst before the response consumer can apply backpressure.
      if (resume.frames.length > 50) {
        resume.reset = true;
        resume.frames = [];
      }
      send(
        `retry: 1000\nevent: connected\ndata: ${JSON.stringify({ resume: resume.reset ? "reset" : "ok", heartbeatMs: 25000 })}\n\n`,
      );
      for (const frame of resume.frames) emit(frame);
      if (closed) return;
      for (const response of responses) {
        const reader = response.body!.getReader();
        readers.push(reader);
        const decoder = new TextDecoder(),
          parse = frameParser((frame) => {
            const hint = sourceHint(frame);
            if (hint) {
              const validated = liveHint({
                ...hint,
                version: hint.version ?? 0,
              });
              if (validated)
                liveHub.publish(
                  scope,
                  { ...validated, version: hint.version },
                  hint.revision,
                );
            }
          });
        void (async () => {
          try {
            while (!closed) {
              const next = await reader.read();
              if (next.done) break;
              parse(decoder.decode(next.value, { stream: true }));
            }
          } catch {
          } finally {
            close();
          }
        })();
      }
      heartbeat = setInterval(
        () => send(`: keepalive ${Date.now()}\n\n`),
        25000,
      );
      // Refresh auth and memberships through the source handlers on every reopen.
      expiry = setTimeout(close, 4 * 60 * 1000);
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
