import { expect, it } from "vitest";
import { parseStoredDestinationSession } from "./drawing-destination-session-validation";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const session = {
  phase: "resume",
  request: {
    jobId: id,
    authorName: "Author",
    draft: {
      kind: "markup",
      sheetId: id,
      id,
      expectedRevision: 0,
      visibility: "private",
      data: {
        sourceSheetId: id,
        type: "link",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        stroke: "#facc15",
        width: 2,
      },
    },
    returnTo: {
      href: `/jobs/${id}/drawings`,
      title: "Source",
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
  },
};
it("restores the complete validated markup session and defaults unsaved resume state", () => {
  const restored = parseStoredDestinationSession(JSON.stringify(session));
  expect(restored?.phase).toBe("resume");
  expect(restored?.request.draft.kind).toBe("markup");
  expect(restored?.request.returnTo.title).toBe("Source");
  if (restored?.phase === "resume") expect(restored.request.saved).toBe(false);
});
it("rejects unsafe source links, malformed drawing payloads, and oversized stored sessions", () => {
  expect(
    parseStoredDestinationSession(
      JSON.stringify({
        ...session,
        request: {
          ...session.request,
          returnTo: {
            ...session.request.returnTo,
            href: "https://outside.invalid/private",
          },
        },
      }),
    ),
  ).toBeNull();
  expect(
    parseStoredDestinationSession(
      JSON.stringify({
        ...session,
        request: {
          ...session.request,
          draft: {
            ...session.request.draft,
            data: {
              ...session.request.draft.data,
              points: [{ x: "invalid", y: 0 }],
            },
          },
        },
      }),
    ),
  ).toBeNull();
  expect(parseStoredDestinationSession("not-json")).toBeNull();
  expect(parseStoredDestinationSession("x".repeat(1_000_001))).toBeNull();
});
