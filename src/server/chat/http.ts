import { TRPCError } from "@trpc/server";
export function chatHttpError(error: unknown) {
  const status =
    error instanceof TRPCError
      ? ((
          {
            UNAUTHORIZED: 401,
            FORBIDDEN: 403,
            NOT_FOUND: 404,
            BAD_REQUEST: 400,
            CONFLICT: 409,
            TOO_MANY_REQUESTS: 429,
            PAYLOAD_TOO_LARGE: 413,
            TIMEOUT: 408,
          } as Partial<Record<string, number>>
        )[error.code] ?? 500)
      : 500;
  if (status === 500) console.error("Job chat request failed", error);
  return Response.json(
    {
      error:
        status === 500
          ? "Chat request failed. Please try again."
          : (error as Error).message,
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
