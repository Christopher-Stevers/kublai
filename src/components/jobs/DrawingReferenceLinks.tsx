"use client";
import { useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { findDrawingReferences } from "~/lib/drawing-reference-links";
import type { DrawingText } from "~/lib/drawing-text";
import type { DrawingWorkspace } from "~/lib/drawing-workspace";
import { Button } from "~/components/ui/button";
export function DrawingReferenceLinks({
  workspace,
  sourceSheetId,
  words,
  online,
}: {
  workspace: DrawingWorkspace;
  sourceSheetId: string;
  words: DrawingText[];
  online: boolean;
}) {
  const utils = api.useUtils();
  const summaries = api.drawingsWorkspace.list.useQuery({
    jobId: workspace.jobId,
  });
  const mutation = api.drawingsWorkspace.save.useMutation();
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<string[]>([]);
  const candidates = useMemo(
    () =>
      findDrawingReferences(
        words,
        workspace.jobSheets,
        summaries.data ?? [],
        sourceSheetId,
        workspace.entities,
      ).filter((row) => !created.includes(row.key)),
    [
      words,
      workspace.jobSheets,
      workspace.entities,
      summaries.data,
      sourceSheetId,
      created,
    ],
  );
  if (!words.length) return null;
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">Suggested sheet links</h3>
      <p className="text-muted-foreground text-xs">
        References matching uploaded sheet numbers. Add a link to make that
        reference tappable; links begin as private markups.
      </p>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No new sheet references found.
        </p>
      ) : (
        candidates.map((row) => (
          <div key={row.key} className="rounded border p-2">
            <p className="truncate text-sm">{row.word.text}</p>
            <p className="text-muted-foreground text-xs">
              Opens {row.target.name}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!online || mutation.isPending}
              onClick={() => {
                void mutation
                  .mutateAsync({
                    id: crypto.randomUUID(),
                    sheetId: workspace.sheetId,
                    expectedRevision: 0,
                    expectedUserId: workspace.actor.id,
                    kind: "markup",
                    visibility: "private",
                    data: {
                      sourceSheetId,
                      type: "link",
                      points: [
                        { x: row.word.left, y: row.word.top },
                        { x: row.word.right, y: row.word.bottom },
                      ],
                      stroke: "#2563eb",
                      width: 1,
                      fill: "#2563eb22",
                      text: row.number,
                      targetSheetId: row.target.id,
                    },
                  })
                  .then(async () => {
                    setCreated((old) => [...old, row.key]);
                    setMessage("Sheet link saved.");
                    await utils.drawingsWorkspace.get.invalidate({
                      sheetId: workspace.sheetId,
                    });
                  })
                  .catch((error: unknown) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Link could not be saved.",
                    ),
                  );
              }}
            >
              Add link to {row.number}
            </Button>
          </div>
        ))
      )}
    </section>
  );
}
