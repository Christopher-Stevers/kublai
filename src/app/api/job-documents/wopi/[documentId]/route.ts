import { z } from "zod";
import {
  authorizeWopiRequest,
  wopiErrorResponse,
  wopiFileInfo,
} from "~/server/documents/wopi";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const documentId = z.uuid().parse((await params).documentId);
    const jobId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("jobId"));
    const { config, claims, access } = await authorizeWopiRequest(
      request,
      documentId,
      jobId,
    );
    return Response.json(await wopiFileInfo(config, claims, access), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return wopiErrorResponse(error);
  }
}
