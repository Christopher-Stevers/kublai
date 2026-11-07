// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("./service", () => ({ lockChatJob: vi.fn() }));
import {
  MAX_ATTACHMENT_BYTES,
  readBoundedBody,
  safeFileName,
  validateAttachment,
} from "./attachments";

describe("private chat attachment validation", () => {
  it("limits streamed bytes even without a content length", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    await expect(
      readBoundedBody(
        new Request("http://local.invalid", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit),
        10,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("times out stalled bodies and releases the reader", async () => {
    vi.useFakeTimers();
    try {
      const body = new ReadableStream<Uint8Array>({
        start() {
          /* Deliberately never produces or closes. */
        },
      });
      const rejected = expect(
        readBoundedBody(
          new Request("http://local.invalid", {
            method: "POST",
            body,
            duplex: "half",
          } as RequestInit),
        ),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(60_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects invalid declared lengths, empty files, and oversized files before reading", async () => {
    for (const length of ["-1", "abc", String(MAX_ATTACHMENT_BYTES + 1)]) {
      await expect(
        readBoundedBody(
          new Request("http://local.invalid", {
            method: "POST",
            headers: { "content-length": length },
            body: "x",
          }),
        ),
      ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    }
    await expect(
      readBoundedBody(
        new Request("http://local.invalid", { method: "POST", body: "" }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("does not trust MIME claims, SVG, or renamed non-images", async () => {
    await expect(
      validateAttachment(Buffer.from("<svg>"), "image/svg+xml"),
    ).rejects.toThrow();
    await expect(
      validateAttachment(Buffer.from("<html>hello"), "image/png"),
    ).rejects.toThrow();
    await expect(
      validateAttachment(Buffer.from("not a pdf"), "application/pdf"),
    ).rejects.toThrow();
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(validateAttachment(png, "image/png")).resolves.toBeUndefined();
    await expect(validateAttachment(png, "image/jpeg")).rejects.toThrow();
  });
  it("strips path components and header-control characters from display names", () => {
    expect(safeFileName("../../drawing.pdf")).toBe("drawing.pdf");
    expect(safeFileName("C:\\fakepath\\photo.png")).toBe("photo.png");
    expect(safeFileName("a\r\nb\u0000.png")).toBe("ab.png");
    expect(safeFileName(" ")).toBe("attachment");
    expect(safeFileName("x".repeat(300))).toHaveLength(200);
  });
});
