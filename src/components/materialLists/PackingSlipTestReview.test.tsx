import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PackingSlipTestReview } from "./PackingSlipTestReview";
vi.mock("./SlipLineImage", () => ({
  SlipLineImage: ({ label }: { label: string }) => <div>{label}</div>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows saved crops and separate confidence without receipt actions", async () => {
  const id = "447413ce-c666-4bb9-b289-4156f4be016a";
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          review: {
            versionId: id,
            documentId: id,
            model: "jev-1.14.0",
            rows: [
              {
                page: 2,
                index: 2,
                box: { x: 0, y: 0.2, width: 1, height: 0.1 },
                locationConfidence: 0.9,
                kind: { value: "one", confidence: 0.99 },
                part: { value: "2-inch Fernco Cap", confidence: 0.9 },
                shipped: { value: "0", confidence: 0.39 },
                backordered: { value: "0", confidence: 0.3 },
              },
            ],
          },
        }),
      }),
  );
  render(<PackingSlipTestReview jobId={id} versionId={id} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Open Jev test review" }),
  );
  expect(screen.getByText("Page 2, detected row 2")).toBeTruthy();
  expect(
    screen.getByText("0 · 39% confidence · Needs human review"),
  ).toBeTruthy();
  expect(
    screen.getByText("0 · 30% confidence · Needs human review"),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /confirm receipt/i })).toBeNull();
});
