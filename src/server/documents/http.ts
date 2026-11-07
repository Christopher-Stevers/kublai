import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const url = new URL(request.url);
  // Next can expose its internal origin behind the trusted reverse proxy. The
  // HTTP Host remains the requested public authority; never trust Forwarded-Host.
  const host = request.headers.get("host");
  const publicOrigin =
    host && /^[a-z0-9.[\]:-]+$/i.test(host)
      ? `${request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol}//${host}`
      : url.origin;
  if (
    site === "cross-site" ||
    (origin && origin !== url.origin && origin !== publicOrigin)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cross-origin document changes are not allowed.",
    });
}
export async function readBoundedBody(request: Request, limit: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Request exceeds the permitted size.",
    });
  if (!request.body)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Request body is empty.",
    });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 60_000);
  try {
    while (true) {
      const next = await reader.read();
      if (timedOut)
        throw new TRPCError({
          code: "TIMEOUT",
          message: "Upload timed out. Try again.",
        });
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "Request exceeds the permitted size.",
        });
      }
      chunks.push(next.value);
    }
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  if (!size)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Request body is empty.",
    });
  return Buffer.concat(chunks);
}
export function documentHttpError(error: unknown) {
  const codes: Record<string, number> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    BAD_REQUEST: 400,
    CONFLICT: 409,
    PAYLOAD_TOO_LARGE: 413,
    TIMEOUT: 408,
    TOO_MANY_REQUESTS: 429,
  };
  const status =
    error instanceof ZodError
      ? 400
      : error instanceof TRPCError
        ? (codes[error.code] ?? 500)
        : 500;
  if (status === 500) console.error("Document request failed", error);
  return Response.json(
    {
      error:
        status === 500
          ? "Documents could not be loaded or saved. Please try again."
          : error instanceof ZodError
            ? (error.issues[0]?.message ?? "Invalid request.")
            : (error as Error).message,
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
