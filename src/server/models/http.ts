import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
export function modelHttpError(error: unknown) {
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
  if (status === 500) console.error("[models] request failed", error);
  return Response.json(
    {
      error:
        status === 500
          ? "The model could not be loaded or saved. Try again."
          : error instanceof ZodError
            ? error.issues[0]?.message
            : (error as Error).message,
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
