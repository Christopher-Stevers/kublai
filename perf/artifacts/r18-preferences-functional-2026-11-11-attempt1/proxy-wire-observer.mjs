import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { decodeObservedTrpcResponse } from "./observed-trpc-response.mjs";
export const CONTEXT_HEADER = "x-perf-functional-context";
export const REQUEST_HEADER = "x-perf-functional-request";
const codes = new Set([
  "WIRE_SIZE_BOUND",
  "WIRE_TIMEOUT",
  "WIRE_ABORTED",
  "WIRE_ERROR",
  "WIRE_ENCODING_UNSUPPORTED",
  "WIRE_DECOMPRESSION_FAILED",
  "WIRE_DECODE_FAILED",
  "WIRE_INVALID_JSON",
  "WIRE_TRUNCATED_JSONL",
  "WIRE_ENVELOPE_INVALID",
  "AUTHORITY_SCHEMA_MISSING",
]);
const failure = (code) => Object.assign(Error(code), { observationCode: code });
export function observationFailureCode(error) {
  if (codes.has(error?.observationCode)) return error.observationCode;
  if (error?.name === "SyntaxError") return "WIRE_INVALID_JSON";
  if (error?.message === "Observed JSONL truncated line")
    return "WIRE_TRUNCATED_JSONL";
  if (/Observed response (?:entry|data|head)/.test(error?.message ?? ""))
    return "WIRE_ENVELOPE_INVALID";
  return "WIRE_DECODE_FAILED";
}
/** Instrumentation stays on the browser->private proxy leg only. */
export function stripObservationHeaders(headers) {
  const forwarded = { ...headers };
  const contextId = forwarded[CONTEXT_HEADER],
    requestId = forwarded[REQUEST_HEADER];
  delete forwarded[CONTEXT_HEADER];
  delete forwarded[REQUEST_HEADER];
  const valid =
    ["consumer", "producer"].includes(contextId) &&
    typeof requestId === "string" &&
    new RegExp("^" + contextId + "-[0-9]{1,6}$").test(requestId);
  return {
    headers: forwarded,
    contextId: valid ? contextId : null,
    requestId: valid ? requestId : null,
  };
}
/** Tee actual upstream bytes via a data listener; caller pipes immediately.
 * Finite tracked responses may finish after browser cancellation. This changes
 * upstream cancellation timing for observation only; no new request is issued.
 * Byte/time caps include compressed bytes; decompression has an output cap. */
export function collectObservedWire(
  upstream,
  { requestAccept, count, maxBytes = 512 * 1024, timeoutMs = 5000 },
) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0,
      done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      upstream.off("data", data);
      upstream.off("end", end);
      upstream.off("error", errorEvent);
      upstream.off("aborted", aborted);
      upstream.off("close", close);
      if (error) {
        reject(error);
        return;
      }
      void (async () => {
        let body = Buffer.concat(chunks),
          encoding = String(
            upstream.headers?.["content-encoding"] ?? "identity",
          ).toLowerCase();
        const unpack = {
          gzip: gunzipSync,
          deflate: inflateSync,
          br: brotliDecompressSync,
        };
        if (encoding !== "identity" && encoding !== "") {
          if (!unpack[encoding]) throw failure("WIRE_ENCODING_UNSUPPORTED");
          try {
            body = unpack[encoding](body, { maxOutputLength: maxBytes });
          } catch {
            throw failure("WIRE_DECOMPRESSION_FAILED");
          }
        }
        if (body.length > maxBytes) throw failure("WIRE_SIZE_BOUND");
        const rows = await decodeObservedTrpcResponse({
          body,
          requestAccept,
          contentType: upstream.headers?.["content-type"],
          count,
          maxBytes,
          timeoutMs,
        });
        return {
          rows,
          wireBytes: bytes,
          decodedBytes: body.length,
          requestTransport:
            requestAccept === "application/jsonl" ? "jsonl" : "json",
          responseContentType: String(upstream.headers?.["content-type"] ?? "")
            .split(";")[0]
            .slice(0, 80),
        };
      })().then(resolve, (error) =>
        reject(failure(observationFailureCode(error))),
      );
    };
    const data = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      if (bytes > maxBytes) {
        finish(failure("WIRE_SIZE_BOUND"));
        return;
      }
      chunks.push(buf);
    };
    const end = () => finish();
    const errorEvent = () => finish(failure("WIRE_ERROR"));
    const aborted = () => finish(failure("WIRE_ABORTED"));
    const close = () => {
      if (!done) finish(failure("WIRE_ABORTED"));
    };
    const timer = setTimeout(() => finish(failure("WIRE_TIMEOUT")), timeoutMs);
    upstream.on("data", data);
    upstream.once("end", end);
    upstream.once("error", errorEvent);
    upstream.once("aborted", aborted);
    upstream.once("close", close);
  });
}
