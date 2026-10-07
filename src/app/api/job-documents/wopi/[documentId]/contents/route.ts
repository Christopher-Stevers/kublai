import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  authorizeWopiRequest,
  wopiErrorResponse,
  wopiReadFile,
  wopiSaveFile,
} from "~/server/documents/wopi";
import { readBoundedBody } from "~/server/documents/http";
import { MAX_DOCUMENT_FILE_BYTES } from "~/server/documents/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ documentId: string }> };
async function authorize(request: Request, context: Context) {
  const documentId = z.uuid().parse((await context.params).documentId);
  const jobId = z.uuid().parse(new URL(request.url).searchParams.get("jobId"));
  return authorizeWopiRequest(request, documentId, jobId);
}
export async function GET(request: Request, context: Context) {
  try {
    const { claims, access } = await authorize(request, context);
    const { bytes, version } = await wopiReadFile(claims, access);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "X-WOPI-ItemVersion": version.id,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "attachment",
      },
    });
  } catch (error) {
    return wopiErrorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const { claims, access } = await authorize(request, context);
    if (request.headers.get("x-wopi-override") !== "PUT")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported WOPI operation.",
      });
    if (claims.mode !== "edit")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This editor session is read-only.",
      });
    const bytes = await readBoundedBody(request, MAX_DOCUMENT_FILE_BYTES);
    const result = await wopiSaveFile(
      claims,
      access,
      request.headers.get("x-cool-wopi-timestamp"),
      bytes,
      request.headers.get("x-cool-wopi-extendeddata"),
    );
    return Response.json(
      { LastModifiedTime: result.LastModifiedTime },
      {
        headers: {
          "X-WOPI-ItemVersion": result.versionId,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return wopiErrorResponse(error);
  }
}
