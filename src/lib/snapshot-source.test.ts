import { describe, expect, it } from "vitest";
import {
  makeSnapshotSource,
  readSnapshotState,
  safeSnapshotHref,
  snapshotSourceSchema,
  type SnapshotState,
} from "./snapshot-source";
const job = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sheet = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  set = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  revision = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
describe("snapshot source links", () => {
  it("pins a drawing and its source revision with the actual captured view", () => {
    const state: SnapshotState = {
      version: 1,
      drawing: {
        jobId: job,
        sheetId: sheet,
        setId: set,
        sourceSheetId: revision,
        viewport: { center: { x: 0.32, y: 0.61 }, zoom: 3 },
        appearance: { inverted: true, lineColor: "#f97316" },
        layers: {
          markups: true,
          issues: false,
          private: true,
          published: true,
        },
        selectedId: null,
      },
    };
    const source = makeSnapshotSource(
      "https://app.example/dashboard",
      state,
      "Plumbing QA",
    );
    const url = new URL(source.href, "https://app.example");
    expect(url.pathname).toBe(`/dashboard/jobs/${job}/drawings`);
    expect(url.searchParams.get("drawingSheet")).toBe(sheet);
    expect(url.searchParams.get("drawingSet")).toBe(set);
    expect(readSnapshotState(url.hash)).toEqual(state);
  });
  it("opens the document and preserves its version and PDF page/zoom/scroll", () => {
    const state: SnapshotState = {
      version: 1,
      document: {
        jobId: job,
        documentId: sheet,
        versionId: revision,
        tab: "details",
        viewer: "preview",
      },
      pdf: { page: 3, zoom: 2, left: 0.2, top: 0.35 },
    };
    const url = new URL(
      makeSnapshotSource(
        "https://app.example/dashboard",
        state,
        "Specification v2",
      ).href,
      "https://app.example",
    );
    expect(url.pathname).toBe(`/dashboard/jobs/${job}/documents`);
    expect(url.searchParams.get("document")).toBe(sheet);
    expect(readSnapshotState(url.hash)).toEqual(state);
  });
  it("keeps ordinary page filters and scroll, but strips credentials", () => {
    const source = makeSnapshotSource(
      "https://app.example/dashboard?status=active&access_token=secret&auth=secret",
      { version: 1, scroll: { x: 0, y: 350 } },
      "Jobs",
    );
    expect(source.href).toContain("status=active");
    expect(source.href).not.toContain("secret");
    expect(
      readSnapshotState(new URL(source.href, "https://app.example").hash)
        ?.scroll?.y,
    ).toBe(350);
  });
  it("rejects external, executable, malformed or oversized source locations", () => {
    for (const href of [
      "javascript:alert(1)",
      "//evil.example/dashboard",
      "https://evil.example/dashboard",
      "/dashboard/../../logout",
      "/dashboardevil",
      "/dashboard/\\evil",
      "/dashboard/%5cevil",
    ]) {
      expect(safeSnapshotHref(href)).toBe(false);
      expect(
        snapshotSourceSchema.safeParse({
          href,
          title: "Source",
          capturedAt: "2026-10-09T20:00:00Z",
        }).success,
      ).toBe(false);
    }
    expect(readSnapshotState("#snapshot=%broken")).toBeNull();
    expect(readSnapshotState(`#snapshot=${"a".repeat(17_000)}`)).toBeNull();
    expect(
      readSnapshotState(
        `#snapshot=${encodeURIComponent(JSON.stringify({ version: 1, pdf: { page: -1, zoom: 999, top: 0, left: 0 } }))}`,
      ),
    ).toBeNull();
  });
});
