import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertSameOrigin, readBoundedBody } from "~/server/documents/http";
import { modelHttpError } from "~/server/models/http";
import { modelAccess, requireModelUpload } from "~/server/models/access";
import { writeModelChunk, finishModelUpload } from "~/server/models/storage";
import { registerModel } from "~/server/models/service";
import { MODEL_CHUNK_BYTES } from "~/lib/bim/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ uploadId: string; part: string }> };
async function access(request: Request, context: Context) {
  assertSameOrigin(request);
  const params = await context.params;
  const jobId = z
    .string()
    .uuid()
    .parse(new URL(request.url).searchParams.get("jobId"));
  const id = z.string().uuid().parse(params.uploadId);
  const { userId } = await getRequestIdentity(request.headers, { request });
  const a = await modelAccess(userId, jobId);
  requireModelUpload(a);
  return { a, id, part: params.part };
}
export async function PUT(request: Request, context: Context) {
  try {
    const { a, id, part } = await access(request, context);
    const number = z.coerce.number().int().min(0).max(31).parse(part);
    const bytes = await readBoundedBody(request, MODEL_CHUNK_BYTES);
    const fresh = await modelAccess(a.user.id, a.job.id);
    requireModelUpload(fresh);
    return Response.json(await writeModelChunk(fresh, id, number, bytes), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return modelHttpError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const { a, id, part } = await access(request, context);
    if (part !== "finish")
      return Response.json({ error: "Unknown upload action" }, { status: 400 });
    const file = await finishModelUpload(a, id);
    const fresh = await modelAccess(a.user.id, a.job.id);
    requireModelUpload(fresh);
    return Response.json(await registerModel(fresh, id, file), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return modelHttpError(error);
  }
}
