import { expect, it } from "vitest";
import { snapshotEditHref } from "./snapshot-edit";
it("preserves the drawing view while carrying only the message and conversation IDs", () => {
  const href = snapshotEditHref({
    id: "message",
    conversationId: "chat",
    source: {
      href: "/dashboard/jobs/job/drawings?drawingSheet=sheet#snapshot=recorded",
      title: "Drawing",
      capturedAt: "2026-10-09T22:00:00Z",
    },
  });
  const url = new URL(href, "https://app.invalid");
  expect(url.searchParams.get("drawingSheet")).toBe("sheet");
  expect(url.searchParams.get("editSnapshot")).toBe("message");
  expect(url.hash).toBe("#snapshot=recorded");
});
it("opens older images in their conversation when no source was saved", () => {
  const url = new URL(
    snapshotEditHref({ id: "message", conversationId: "chat" }),
    "https://app.invalid",
  );
  expect(url.pathname).toBe("/dashboard/chat");
  expect(url.searchParams.get("conversation")).toBe("chat");
});
it("never navigates to an unsafe source", () => {
  const href = snapshotEditHref({
    id: "message",
    conversationId: "chat",
    source: {
      href: "https://evil.invalid",
      title: "Fake",
      capturedAt: "2026-10-09T22:00:00Z",
    },
  });
  expect(href.startsWith("/dashboard/chat?")).toBe(true);
});
