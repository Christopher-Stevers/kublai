import { z } from "zod";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { modelAccess } from "~/server/models/access";
import { readModel } from "~/server/models/service";
import { modelBlobPath } from "~/server/models/storage";
import { modelHttpError } from "~/server/models/http";
import { singleByteRange } from "~/server/rooms/file-response";
import { TRPCError } from "@trpc/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    const url = new URL(request.url);
    const jobId = z.string().uuid().parse(url.searchParams.get("jobId"));
    const id = z
      .string()
      .uuid()
      .parse((await params).modelId);
    const { userId } = await getRequestIdentity(request.headers, { request });
    const a = await modelAccess(userId, jobId);
    const m = await readModel(a, id);
    const original = url.searchParams.get("source") === "1";
    const sha = original ? m.sourceSha : m.viewSha;
    if (!sha)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This Revit file has not been converted yet.",
      });
    const file = modelBlobPath(a.job.organizationId, sha);
    const size = (await stat(file)).size;
    const range = singleByteRange(request.headers.get("range"), size);
    const headers = {
      "Content-Type": "application/octet-stream",
      ETag: `"${sha}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(original ? m.data.filename : m.data.name + ".ifc").replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
    };
    if (range === "unsatisfiable")
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    return new Response(
      request.method === "HEAD"
        ? null
        : (Readable.toWeb(
            createReadStream(file, range ?? undefined),
          ) as ReadableStream),
      {
        status: range ? 206 : 200,
        headers: {
          ...headers,
          "Content-Length": String(range ? range.end - range.start + 1 : size),
          ...(range
            ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
            : {}),
        },
      },
    );
  } catch (error) {
    return modelHttpError(error);
  }
}

export const HEAD = GET;
