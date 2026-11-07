import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PackingSlipActivity } from "./PackingSlipActivity";
import type { SlipAnalysis } from "~/lib/packing-slip-review";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const now = Date.parse("2026-10-30T03:00:00Z");
const analysis = {
  runId: "run",
  versionId: "v",
  status: "processing",
  startedAt: new Date(now - 60000).toISOString(),
  items: [],
  lines: [],
  warnings: [],
  activity: [
    {
      at: new Date(now - 20000).toISOString(),
      message: "OCR finished. Matching orders…",
    },
  ],
} satisfies SlipAnalysis;
const job = {
  status: "running",
  updatedAt: new Date(now - 10000).toISOString(),
  leaseUntil: new Date(now + 80000).toISOString(),
};
it("shows saved events and confirms a live worker", () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  render(
    <PackingSlipActivity
      analysis={analysis}
      job={job}
      online
      receivedAt={now}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Running");
  // Collapsed, only the indicator shows.
  expect(screen.queryByText("OCR finished. Matching orders…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Processing activity/ }));
  expect(
    screen.getByText("OCR finished. Matching orders…"),
  ).toBeInTheDocument();
  expect(screen.getByText(/Worker heartbeat 10s ago/)).toBeInTheDocument();
});
it("does not claim an expired worker is running", () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  render(
    <PackingSlipActivity
      analysis={analysis}
      job={{ ...job, leaseUntil: new Date(now - 1).toISOString() }}
      online
      receivedAt={now}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for Worker Confirmation",
  );
});
it("shows lost live updates instead of a misleading running indicator", () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  render(
    <PackingSlipActivity
      analysis={analysis}
      job={job}
      online
      receivedAt={now - 20000}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Live Updates Interrupted",
  );
});
it("shows completion even when the last worker record still says running", () => {
  render(
    <PackingSlipActivity
      analysis={{
        ...analysis,
        status: "ready",
        completedAt: new Date(now).toISOString(),
      }}
      job={job}
      online
      receivedAt={Date.now()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Completed");
});
