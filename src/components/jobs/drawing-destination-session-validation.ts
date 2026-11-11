import { z } from "zod";
import { drawingSaveSchema } from "~/lib/drawing-workspace";
import { snapshotSourceSchema } from "~/lib/snapshot-source";
import type { DestinationSession } from "./drawing-destination-session";

const storedSessionSchema = z.object({
  phase: z.enum(["picking", "resume"]),
  request: z.object({
    jobId: z.uuid(),
    draft: drawingSaveSchema,
    authorName: z.string().max(255),
    returnTo: snapshotSourceSchema,
    saved: z.boolean().optional(),
  }),
});
export function parseStoredDestinationSession(
  raw: string,
): DestinationSession | null {
  try {
    if (!raw || raw.length > 1_000_000) return null;
    const saved = storedSessionSchema.parse(JSON.parse(raw) as unknown);
    if (saved.request.draft.kind !== "markup") return null;
    const request = { ...saved.request, draft: saved.request.draft };
    return saved.phase === "picking"
      ? { phase: "picking", request }
      : {
          phase: "resume",
          request: { ...request, saved: saved.request.saved ?? false },
        };
  } catch {
    return null;
  }
}
