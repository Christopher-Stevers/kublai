import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  trialIndexSchema,
  trialResultSchema,
  trialReaders,
  type TrialResults,
  type TrialReader,
} from "~/lib/packing-slip-trial";
import { documentStorageRoot } from "~/server/documents/storage";
import { documentActor, type DocumentAccess } from "~/server/documents/access";
import { accessibleDocument } from "~/server/documents/domain";
import { readWorkspace } from "~/server/documents/service";
import { userCan } from "~/server/auth/permissions";
import type { DocumentState } from "~/server/documents/types";

const runKey = z.string().regex(/^[a-zA-Z0-9-]{8,80}$/);
function root(access: DocumentAccess) {
  if (!userCan(access.user, "orders.receive"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Order receiving permission is required.",
    });
  return path.join(
    documentStorageRoot,
    ".packing-trials",
    z.uuid().parse(access.job.organizationId),
    z.uuid().parse(access.job.id),
  );
}
async function json(file: string, max = 16 * 1024 * 1024): Promise<unknown> {
  const contents = await readFile(file);
  if (contents.length > max) throw Error("Trial result is too large.");
  return JSON.parse(contents.toString("utf8")) as unknown;
}
export async function trialIndex(access: DocumentAccess, runId?: string) {
  const directory = root(access);
  let id: string;
  if (runId) id = runKey.parse(runId);
  else {
    const latest = await json(path.join(directory, "latest.json"), 1024).catch(
      (e) => {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      },
    );
    if (!latest) return null;
    id = z.object({ runId: runKey }).parse(latest).runId;
  }
  const index = trialIndexSchema.parse(
    await json(path.join(directory, id, "index.json")),
  );
  if (
    index.jobId !== access.job.id ||
    index.organizationId !== access.job.organizationId ||
    index.runId !== id
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This comparison belongs to another job.",
    });
  return index;
}
export async function trialDocument(
  access: DocumentAccess,
  documentId: string,
  runId?: string,
  suppliedState?: DocumentState,
) {
  const state = suppliedState ?? (await readWorkspace(access));
  const doc = accessibleDocument(state, documentActor(access, []), documentId);
  const index = await trialIndex(access, runId);
  const entry = index?.cases.find((c) => c.documentId === doc.id);
  if (!index || !entry) return null;
  const source = state.versions.find(
    (v) => v.id === entry.versionId && v.documentId === doc.id,
  );
  if (source?.sha256 !== entry.sha256)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The comparison source is no longer available.",
    });
  const results: TrialResults = {};
  await Promise.all(
    trialReaders.map(async (reader) => {
      const raw = await json(
        path.join(
          root(access),
          index.runId,
          "results",
          reader,
          `${entry.caseId}.json`,
        ),
      ).catch((e) => {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      });
      if (!raw) return;
      const result = trialResultSchema.parse(raw);
      if (
        result.reader !== reader ||
        result.caseId !== entry.caseId ||
        result.sourceSha256 !== entry.sha256
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "The comparison does not match this source file.",
        });
      results[reader] = result;
    }),
  );
  return {
    runId: index.runId,
    entry,
    results,
    stale: doc.currentVersionId !== entry.versionId,
    sourceUrl: `/api/job-documents/files/${entry.versionId}?jobId=${access.job.id}`,
  };
}
export async function trialSummary(access: DocumentAccess) {
  const index = await trialIndex(access);
  if (!index) return null;
  const state = await readWorkspace(access),
    actor = documentActor(access, []);
  const cases = index.cases.filter((c) => {
    try {
      accessibleDocument(state, actor, c.documentId);
      return true;
    } catch {
      return false;
    }
  });
  const counts = Object.fromEntries(
    trialReaders.map((reader) => [
      reader,
      {
        complete: cases.filter((c) => c.readers?.[reader] === "complete")
          .length,
        failed: cases.filter((c) => c.readers?.[reader] === "failed").length,
        total: cases.filter(
          (c) => c.readers?.[reader] !== undefined || reader !== "liquid",
        ).length,
      },
    ]),
  ) as Record<TrialReader, { complete: number; failed: number; total: number }>;
  return {
    runId: index.runId,
    updatedAt: index.updatedAt,
    counts,
    cases: cases.map((c) => ({ documentId: c.documentId, readers: c.readers })),
  };
}
