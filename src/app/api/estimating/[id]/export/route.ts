import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "~/server/db";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { getEstimate } from "~/server/estimating/service";
import {
  estimatePdf,
  estimateWorkbook,
  proposalCsv,
} from "~/server/estimating/exports";
import { exportEstimateCsv } from "~/lib/estimating/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const url = new URL(request.url);
    const format = z
      .enum(["csv", "xlsx", "pdf"])
      .parse(url.searchParams.get("format") ?? "pdf");
    const view = z
      .enum(["internal", "proposal"])
      .parse(url.searchParams.get("view") ?? "proposal");
    const identity = await getRequestIdentity(request.headers, { request });
    if (!identity.userId || !identity.user)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in to export estimates.",
      });
    const estimate = await getEstimate(
      {
        db,
        user: identity.user,
        userId: identity.userId,
        actorUser: identity.actorUser,
        simulation: identity.simulation,
      },
      id,
    );
    const filename = `${estimate.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "estimate"}-r${estimate.revision}-${view}.${format}`;
    const headers = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (format === "csv")
      return new Response(
        "\uFEFF" +
          (view === "proposal"
            ? proposalCsv(estimate)
            : exportEstimateCsv(estimate.document)),
        { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } },
      );
    const bytes =
      format === "pdf"
        ? await estimatePdf(estimate, view)
        : estimateWorkbook(estimate, view);
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        ...headers,
        "Content-Type":
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    const codes: Partial<Record<TRPCError["code"], number>> = {
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      BAD_REQUEST: 400,
    };
    const status =
      error instanceof TRPCError
        ? (codes[error.code] ?? 500)
        : error instanceof z.ZodError
          ? 400
          : 500;
    const message =
      status === 500
        ? "Could not export estimate. Please retry."
        : error instanceof Error
          ? error.message
          : "Invalid export request.";
    return Response.json(
      { error: message },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
