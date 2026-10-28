import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertCan } from "~/server/auth/permissions";
import { documentBlobPath } from "~/server/documents/storage";
import type { hyperlinkDetectInput } from "~/lib/hyperlink-readers";
import { accessSheet, type DrawingContext } from "./service";
import { drawingPdfLocation } from "./equipment-index";
import { jobEquipmentVocabulary, jobFiles } from "./equipment-register";
import { hyperlinkImages } from "./hyperlink-images";
import {
  HYPERLINK_MODELS,
  HYPERLINK_READER_REVISION,
  hyperlinkReaderConfigured,
  readHyperlinkVision,
} from "./hyperlink-vision";
import { reserveHyperlinkRun } from "./hyperlink-reader-store";
import { hyperlinkReaderRuns } from "./hyperlink-reader-schema";

async function readable(ctx: DrawingContext, sheetId: string) {
  const access = await accessSheet(ctx.db, ctx.userId, sheetId);
  assertCan(access.user, "drawings.sheetTools");
  if (!access.canAnnotate)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Drawing editing permission is required.",
    });
  return access;
}
export async function hyperlinkReaderOptions(
  ctx: DrawingContext,
  sheetId: string,
) {
  await readable(ctx, sheetId);
  return {
    normal: { available: true, model: null },
    terra: {
      available: hyperlinkReaderConfigured("terra"),
      model: HYPERLINK_MODELS.terra,
    },
    deepseek: {
      available: hyperlinkReaderConfigured("deepseek"),
      model: HYPERLINK_MODELS.deepseek,
    },
  };
}
export async function detectHyperlinkTags(
  ctx: DrawingContext,
  input: z.infer<typeof hyperlinkDetectInput>,
) {
  await readable(ctx, input.sheetId);
  if (!hyperlinkReaderConfigured(input.reader))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${input.reader === "terra" ? "Terra" : "DeepSeek"} is not connected on this server yet. Normal is available.`,
    });
  const job = await jobFiles(ctx, input.sheetId);
  const source = job.context.sheets.find((s) => s.id === input.sourceSheetId);
  if (!source)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The source drawing is no longer available.",
    });
  const sourceAccess = await readable(ctx, source.id);
  if (
    sourceAccess.sheet.jobId !== job.context.access.sheet.jobId ||
    sourceAccess.actor.organizationId !==
      job.context.access.actor.organizationId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The source is outside this job.",
    });
  const { jobId, organizationId } = sourceAccess.sheet;
  let location = drawingPdfLocation(source.imageUrl, jobId);
  if (!location && sourceAccess.sheet.documentVersionId) {
    const version = job.context.docs.versions.find(
      (v) => v.id === sourceAccess.sheet.documentVersionId,
    );
    const match =
      /^\/api\/job-documents\/pages\/([0-9a-f-]{36})\/([1-9]\d*)\?/.exec(
        source.imageUrl,
      );
    if (version?.mimeType === "application/pdf" && match?.[1] === version.id)
      location = {
        file: documentBlobPath(organizationId, version.sha256),
        page: Number(match[2]),
      };
  }
  if (!location)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This drawing has no PDF source for the image reader.",
    });
  if ((await stat(location.file)).size > 160 * 1024 * 1024)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "The source PDF exceeds the reading limit.",
    });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(location.file)) {
    if (!Buffer.isBuffer(chunk)) throw Error("The drawing could not be read.");
    hash.update(chunk);
  }
  const vocabulary = await jobEquipmentVocabulary(ctx, input.sheetId);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        revision: HYPERLINK_READER_REVISION,
        model: HYPERLINK_MODELS[input.reader],
        file: hash.digest("hex"),
        page: location.page,
        tags: vocabulary.knownTags.slice(0, 1000).sort(),
      }),
    )
    .digest("hex");
  const verifyAccess = async () => {
    const [target, currentSource] = await Promise.all([
      readable(ctx, input.sheetId),
      readable(ctx, input.sourceSheetId),
    ]);
    if (
      target.sheet.jobId !== jobId ||
      currentSource.sheet.jobId !== jobId ||
      target.actor.organizationId !== organizationId ||
      currentSource.actor.organizationId !== organizationId ||
      currentSource.sheet.imageUrl !== source.imageUrl ||
      currentSource.sheet.documentVersionId !==
        sourceAccess.sheet.documentVersionId
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The drawing changed while it was being read. Reopen Auto Hyperlink.",
      });
  };
  await verifyAccess();
  const reserved = await reserveHyperlinkRun(
    ctx.db,
    {
      id: input.requestId,
      organizationId,
      jobId,
      sourceSheetId: source.id,
      userId: ctx.userId,
      reader: input.reader,
      fingerprint,
    },
    input.refresh,
  );
  if (reserved.cached) {
    await verifyAccess();
    return { ...reserved.cached, cached: true };
  }
  try {
    const page = await hyperlinkImages(location.file, location.page);
    await verifyAccess();
    const result = await readHyperlinkVision(
      input.reader,
      page.images,
      page.words,
      vocabulary.knownTags,
    );
    if (vocabulary.pending || vocabulary.failed)
      result.warnings.push(
        "Some schedules are still unreadable or indexing; unfamiliar tags may be missed.",
      );
    await verifyAccess();
    await ctx.db
      .update(hyperlinkReaderRuns)
      .set({ status: "done", result, updatedAt: new Date() })
      .where(eq(hyperlinkReaderRuns.id, input.requestId));
    return { ...result, cached: false };
  } catch (error) {
    await ctx.db
      .update(hyperlinkReaderRuns)
      .set({
        status: "failed",
        error: "Drawing reading failed; retry explicitly.",
        updatedAt: new Date(),
      })
      .where(eq(hyperlinkReaderRuns.id, input.requestId));
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error &&
        !(error instanceof z.ZodError) &&
        error.message.length <= 300 &&
        !/json|zod|parse|abort|timeout/i.test(error.message)
          ? error.message
          : "The reader could not finish a valid reading. Read again or choose Normal.",
    });
  }
}
