import { z } from "zod";
export const SNAPSHOT_FREEZE_EVENT = "foremanhq:snapshot-freeze";

const coordinate = z.number().finite().min(-10).max(10);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const point = z.object({ x: coordinate, y: coordinate });
const viewport = z.object({
  center: point,
  zoom: z.number().min(0.05).max(24),
});
export const snapshotStateSchema = z.object({
  version: z.literal(1),
  drawing: z
    .object({
      jobId: z.uuid(),
      sheetId: z.uuid(),
      setId: z.uuid(),
      sourceSheetId: z.uuid(),
      viewport,
      appearance: z.object({
        inverted: z.boolean(),
        lineColor: color.nullable(),
      }),
      layers: z.object({
        markups: z.boolean(),
        issues: z.boolean(),
        private: z.boolean(),
        published: z.boolean(),
      }),
      selectedId: z.uuid().nullable(),
    })
    .optional(),
  overlay: z
    .object({
      ids: z.array(z.uuid()).min(2).max(20),
      mode: z.enum(["overlay", "wipe", "side-by-side", "difference"]),
      wipe: z.number().min(0).max(1),
      inks: z.record(
        z.uuid(),
        z.object({ color, opacity: z.number().min(0).max(1) }),
      ),
      alignments: z.record(
        z.string().max(80),
        z.object({
          x: coordinate,
          y: coordinate,
          scale: z.number().min(0.01).max(100),
        }),
      ),
      selectedId: z.uuid(),
    })
    .optional(),
  document: z
    .object({
      jobId: z.uuid(),
      documentId: z.uuid(),
      versionId: z.uuid().nullable(),
      tab: z.enum(["details", "versions", "comments", "activity"]),
      viewer: z.enum(["preview", "office"]),
      scroll: z.number().min(0).max(1).optional(),
    })
    .optional(),
  pdf: z
    .object({
      page: z.number().int().min(1).max(100_000),
      zoom: z.number().min(1).max(3),
      left: z.number().min(0).max(1),
      top: z.number().min(0).max(1),
    })
    .optional(),
  scroll: z
    .object({
      x: z.number().min(0).max(10_000_000),
      y: z.number().min(0).max(10_000_000),
    })
    .optional(),
});
export type SnapshotState = z.infer<typeof snapshotStateSchema>;
export type SnapshotStateKey = Exclude<
  keyof SnapshotState,
  "version" | "scroll"
>;
const localBase = "https://snapshot.invalid";
export function safeSnapshotHref(href: string) {
  if (
    !href.startsWith("/dashboard") ||
    href.startsWith("//") ||
    /[\\\x00-\x20]/.test(href)
  )
    return false;
  try {
    const url = new URL(href, localBase);
    return (
      url.origin === localBase &&
      (url.pathname === "/dashboard" ||
        url.pathname.startsWith("/dashboard/")) &&
      !/%(?:2f|5c)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export const snapshotSourceSchema = z.object({
  href: z
    .string()
    .max(16_000)
    .refine(safeSnapshotHref, "Snapshot links must open a ForemanHQ page."),
  title: z.string().trim().min(1).max(200),
  capturedAt: z.iso.datetime(),
});
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;
export function readSnapshotState(hash: string): SnapshotState | null {
  if (!hash.startsWith("#snapshot=") || hash.length > 16_000) return null;
  try {
    const result = snapshotStateSchema.safeParse(
      JSON.parse(decodeURIComponent(hash.slice(10))) as unknown,
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function currentSnapshotState() {
  return typeof window === "undefined"
    ? null
    : readSnapshotState(window.location.hash);
}
export function makeSnapshotSource(
  href: string,
  state: SnapshotState,
  title: string,
): SnapshotSource {
  const url = new URL(href, localBase);
  // Session credentials never belong in a share link.
  for (const key of [...url.searchParams.keys()])
    if (
      /^(?:access_token|refresh_token|token|secret|auth|authorization|code|password)$/i.test(
        key,
      )
    )
      url.searchParams.delete(key);
  if (state.drawing) {
    url.pathname = `/dashboard/jobs/${state.drawing.jobId}/drawings`;
    url.search = "";
    url.searchParams.set("drawingSet", state.drawing.setId);
    url.searchParams.set("drawingSheet", state.drawing.sheetId);
  } else if (state.document) {
    url.pathname = `/dashboard/jobs/${state.document.jobId}/documents`;
    url.search = "";
    url.searchParams.set("document", state.document.documentId);
  }
  url.hash = `snapshot=${encodeURIComponent(JSON.stringify(snapshotStateSchema.parse(state)))}`;
  return snapshotSourceSchema.parse({
    href: `${url.pathname}${url.search}${url.hash}`,
    title: title.trim().slice(0, 200) || "Snapshot source",
    capturedAt: new Date().toISOString(),
  });
}
