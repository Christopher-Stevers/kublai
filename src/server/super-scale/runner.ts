import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { superScaleJobs } from "~/server/db/super-scale-schema";
import {
  accessSheet,
  getDrawingWorkspace,
  listDrawingWorkspace,
} from "../drawings/service";
import { assertDrawingManager } from "../drawings/domain";
import { createServerGridReader } from "./reader";
import { gridSpacing, transferGridScale } from "~/lib/super-scale";
import type { SuperScaleOutput, SuperScaleResult } from "~/lib/super-scale-job";
import { notifySuperScale } from "./notify";
import { drawingNotificationUrl } from "../drawings/notification-policy";

/** A database lock serializes heavy scans across web processes and releases on worker death.
 * A running row without this lock is an interrupted job and is safe to resume from cached pages. */
export async function runNextSuperScale() {
  await db.transaction(async (lock) => {
    const [held] = await lock.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(79153812) as locked`,
    );
    if (!held?.locked) return;
    const [job] = await db
      .select()
      .from(superScaleJobs)
      .where(inArray(superScaleJobs.status, ["queued", "running"]))
      .orderBy(asc(superScaleJobs.createdAt))
      .limit(1);
    if (!job) return;
    await db
      .update(superScaleJobs)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        progress: "Reading reference grid lines…",
      })
      .where(
        and(
          eq(superScaleJobs.id, job.id),
          inArray(superScaleJobs.status, ["queued", "running"]),
        ),
      );
    const ctx = { db, userId: job.userId };
    let reader: ReturnType<typeof createServerGridReader> | undefined;
    let output: SuperScaleOutput | null = null;
    let error: string | null = null;
    let reviewUrl = "";
    const stillRunning = async () => {
      const [row] = await db
        .select({ status: superScaleJobs.status })
        .from(superScaleJobs)
        .where(eq(superScaleJobs.id, job.id));
      return row?.status === "running";
    };
    try {
      if (job.attempts >= 3)
        throw Error(
          "Grid analysis was interrupted repeatedly. Please retry with fewer drawings.",
        );
      const access = await accessSheet(db, job.userId, job.sheetId);
      assertDrawingManager(access.actor);
      if (access.actor.organizationId !== job.organizationId)
        throw Error("Drawing access changed");
      const workspace = await getDrawingWorkspace(ctx, job.sheetId);
      const source = workspace.jobSheets.find(
        (s) => s.id === workspace.metadata.currentSourceSheetId,
      );
      if (!source || !workspace.metadata.scale)
        throw Error("Set the reference drawing scale first.");
      reviewUrl =
        drawingNotificationUrl(
          workspace.jobId,
          access.sheet.setId ?? "",
          job.sheetId,
        ) + "&superScale=review";
      reader = createServerGridReader(workspace.jobId);
      const reference = await reader.read(source.imageUrl);
      output = {
        reference,
        revision: workspace.metadata.revision,
        sourceId: source.id,
        first: job.first,
        second: job.second,
        rows: [],
      };
      if (job.first) {
        if (!gridSpacing(reference, job.first, job.second))
          throw Error("Reference grid pair is missing or ambiguous.");
        const summaries = await listDrawingWorkspace(ctx, workspace.jobId),
          byId = new Map(workspace.jobSheets.map((s) => [s.id, s]));
        const revisions = new Set(
          summaries
            .filter((s) => s.metadata.currentSourceSheetId !== s.sheetId)
            .map((s) => s.metadata.currentSourceSheetId),
        );
        const candidates = summaries
          .filter(
            (s) =>
              s.sheetId !== job.sheetId &&
              !revisions.has(s.sheetId) &&
              s.metadata.status !== "superseded",
          )
          .sort((a, b) =>
            (
              byId.get(a.metadata.currentSourceSheetId)?.imageUrl ?? ""
            ).localeCompare(
              byId.get(b.metadata.currentSourceSheetId)?.imageUrl ?? "",
              undefined,
              { numeric: true },
            ),
          );
        for (const [index, item] of candidates.entries()) {
          if (!(await stillRunning())) return;
          const target = byId.get(item.metadata.currentSourceSheetId);
          if (!target || target.id === source.id) continue;
          await db
            .update(superScaleJobs)
            .set({
              progress: `Checking ${index + 1} of ${candidates.length}: ${target.name}`,
            })
            .where(
              and(
                eq(superScaleJobs.id, job.id),
                eq(superScaleJobs.status, "running"),
              ),
            );
          const row: SuperScaleResult = {
            sheet: target,
            ownerId: item.sheetId,
            metadata: item.metadata,
            selected: false,
            status: "",
          };
          if (item.metadata.scale) row.status = "Already calibrated — kept";
          else
            try {
              row.grids = await reader.read(target.imageUrl);
              const match = transferGridScale(
                reference,
                row.grids,
                job.first,
                job.second,
                workspace.metadata.scale,
              );
              if (match.ok) {
                row.scale = match.scale;
                row.selected = match.checks > 0;
                row.status = match.checks
                  ? `Matched; ${match.checks} additional grid checks`
                  : "Pair found — inspect before selecting";
              } else row.status = match.reason;
            } catch (reason) {
              row.status =
                reason instanceof Error
                  ? reason.message
                  : "Unable to read drawing";
            }
          output.rows.push(row);
        }
      }
      const fresh = await getDrawingWorkspace(ctx, job.sheetId);
      if (
        fresh.metadata.revision !== output.revision ||
        fresh.metadata.currentSourceSheetId !== source.id
      )
        throw Error(
          "The reference drawing changed during analysis. Please run Super scale again.",
        );
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Super scale failed";
    } finally {
      await reader?.close().catch(() => undefined);
    }
    if (!(await stillRunning())) return;
    // Recheck access before delivering sensitive results; revocation never sends a message.
    let notify = false;
    try {
      const a = await accessSheet(db, job.userId, job.sheetId);
      assertDrawingManager(a.actor);
      notify = a.actor.organizationId === job.organizationId;
    } catch {
      error = "Drawing access changed";
      output = null;
    }
    await db.transaction(async (tx) => {
      const [completed] = await tx
        .update(superScaleJobs)
        .set({
          status: error ? "failed" : "completed",
          error,
          output: error ? null : output,
          progress: error ?? "Finished",
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(superScaleJobs.id, job.id),
            eq(superScaleJobs.status, "running"),
          ),
        )
        .returning();
      if (!completed || !job.first || !notify) return;
      const matches = output?.rows.filter((r) => r.scale).length ?? 0;
      const body = error
        ? `Super scale could not finish: ${error}. Open the reference drawing to retry.`
        : `Super scale finished. ${matches} drawing${matches === 1 ? "" : "s"} matched out of ${output?.rows.length ?? 0} checked. Your results are ready to review; no scales have been changed.\n${reviewUrl}`;
      await notifySuperScale(tx, job, body, reviewUrl);
    });
  });
}
