import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrderMatchCandidates } from "./OrderMatchCandidates";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows five ranked choices, marks weak evidence and only previews a selection", async () => {
  const rows = Array.from({length: 6}, (_, index) => ({orderId: `o${index}`, orderNumber: `PO-${index}`, supplier: "Supplier", listName: "List", found: 5-index, weak: index > 2}));
  const fetcher = vi.fn(async () => Response.json(rows));
  const select = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<OrderMatchCandidates jobId="job" documentId="doc" readingKey="ready" selectedId="o0" onSelect={select} />);
  const first = await screen.findByRole("button", {name: "Compare rank 1: PO-0"});
  expect(first).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("button")).toHaveLength(5);
  expect(screen.getAllByText("Weak match — check carefully")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", {name: "Compare rank 3: PO-2"}));
  expect(select).toHaveBeenCalledWith("o2");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledTimes(1);
});
it("does not pad a short candidate list with fake orders", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
  render(<OrderMatchCandidates jobId="job" documentId="doc" readingKey="ready" selectedId="" onSelect={vi.fn()} />);
  await screen.findByText(/No saved reading or eligible orders yet/);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
