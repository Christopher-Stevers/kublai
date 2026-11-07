import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertDocumentAccess } from "~/server/documents/access";
import { blankOfficeDocument } from "~/server/documents/editor-blank";
import { getDocumentEditorConfig } from "~/server/documents/editor-config";
import {
  assertSameOrigin,
  documentHttpError,
  readBoundedBody,
} from "~/server/documents/http";
import { saveDocumentVersion } from "~/server/documents/service";
import {
  detectedDocumentMime,
  writeDocumentBlob,
} from "~/server/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z
  .object({
    jobId: z.string().uuid(),
    folderId: z.string().uuid().nullable().optional(),
    kind: z.enum(["word", "spreadsheet"]),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Send a JSON document request.",
      });
    const { userId } = await getRequestIdentity(request.headers, { request });
    if (!userId)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Sign in to create documents.",
      });
    const input = inputSchema.parse(
      JSON.parse((await readBoundedBody(request, 4096)).toString("utf8")),
    );
    const access = await assertDocumentAccess(userId, input.jobId);
    getDocumentEditorConfig();
    const { name, bytes } = blankOfficeDocument(input.kind, input.name);
    const result = await saveDocumentVersion(
      access,
      {
        name,
        folderId: input.folderId ?? null,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: detectedDocumentMime(bytes, name),
      },
      () => writeDocumentBlob(access.job.organizationId, bytes),
    );
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED")
      return Response.json(
        { error: error.message },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    return documentHttpError(
      error instanceof SyntaxError
        ? new z.ZodError([
            { code: "custom", path: [], message: "Invalid JSON request." },
          ])
        : error,
    );
  }
}
