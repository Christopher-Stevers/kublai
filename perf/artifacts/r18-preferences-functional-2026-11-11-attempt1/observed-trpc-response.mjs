import { jsonlStreamConsumer } from "@trpc/server/unstable-core-do-not-import";
import SuperJSON from "superjson";
const errorCode = (error) => {
  const value = error?.data?.code ?? error?.code;
  return typeof value === "string" && /^[A-Z_]{1,40}$/.test(value)
    ? value
    : typeof value === "number"
      ? value
      : "UNKNOWN";
};
const envelope = (value) =>
  value && typeof value === "object" && Object.hasOwn(value, "json")
    ? SuperJSON.deserialize(value)
    : value;
/** Decode bytes from an already-observed real response. No requests/cache writes.
 * Mirrors installed httpBatchStreamLink: same JSONL consumer/SuperJSON and the
 * nested head -> result -> data promise unwrapping, with explicit size/time caps. */
export async function decodeObservedTrpcResponse({
  body,
  contentType,
  requestAccept = null,
  count,
  maxBytes = 512 * 1024,
  timeoutMs = 5000,
}) {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  if (
    !bytes ||
    bytes.byteLength > maxBytes ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 128
  )
    throw Error("Observed response size/count bound");
  let timer;
  const abortController = new AbortController();
  const decode = async () => {
    const streaming = requestAccept === "application/jsonl";
    let head;
    if (streaming) {
      // Playwright provides completed bytes. Validate every non-ping line first
      // so trailing corruption cannot be hidden by an early resolved head.
      const text = Buffer.from(bytes).toString("utf8");
      if (!text.endsWith("\n")) throw Error("Observed JSONL truncated line");
      const lines = text.split("\n");
      if (lines.length > 4096) throw Error("Observed JSONL line bound");
      for (const line of lines) if (line.trim()) JSON.parse(line);
      [head] = await jsonlStreamConsumer({
        from: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        }),
        deserialize: (value) => SuperJSON.deserialize(value),
        formatError: () => Error("Observed deferred tRPC error"),
        abortController,
      });
    } else {
      const raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
      head = Array.isArray(raw) ? raw : [raw];
    }
    if (!head || typeof head !== "object")
      throw Error("Observed response head missing");
    return Promise.all(
      Array.from({ length: count }, async (_, index) => {
        if (!Object.hasOwn(head, String(index)))
          throw Error("Observed response entry missing");
        let row;
        try {
          row = await Promise.resolve(head[index]);
        } catch {
          return { ok: false, errorCode: "DEFERRED_ERROR" };
        }
        if (row?.error)
          return {
            ok: false,
            errorCode: errorCode(streaming ? row.error : envelope(row.error)),
          };
        if (!row || !("result" in row))
          throw Error("Observed response entry malformed");
        try {
          const result = await Promise.resolve(row.result);
          if (!result || !Object.hasOwn(result, "data"))
            throw Error("Observed response data missing");
          const data = await Promise.resolve(result.data);
          return { ok: true, data: streaming ? data : envelope(data) };
        } catch (error) {
          if (error.message === "Observed response data missing") throw error;
          return { ok: false, errorCode: "DEFERRED_ERROR" };
        }
      }),
    );
  };
  try {
    return await Promise.race([
      decode(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(Error("Observed response decode timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** Public Playwright response observation, never a second/fabricated HTTP fetch.
 * Content-length is rejected early where present; Playwright buffers the body,
 * so absent-length memory is bounded only after receipt (explicit limitation). */
export async function decodePlaywrightTrpcResponse(
  response,
  count,
  { maxBytes = 512 * 1024, timeoutMs = 5000 } = {},
) {
  const headers = response.headers();
  const length = Number(headers["content-length"]);
  if (Number.isFinite(length) && length > maxBytes)
    throw Error("Observed response size bound");
  let timer;
  try {
    const body = await Promise.race([
      response.body(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Observed response body timeout")),
          timeoutMs,
        );
      }),
    ]);
    return await decodeObservedTrpcResponse({
      body,
      contentType: headers["content-type"],
      requestAccept: response.request().headers()["trpc-accept"] ?? null,
      count,
      maxBytes,
      timeoutMs,
    });
  } finally {
    clearTimeout(timer);
  }
}
