import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrderMatchCandidates } from "./OrderMatchCandidates";
import { sureOrder } from "~/lib/order-match-comparison";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows five ranked choices, marks weak evidence and only previews a selection", async () => {
  const rows = Array.from({length: 6}, (_, index) => ({orderId: `o${index}`, orderNumber: `PO-${index}`, supplier: "Supplier", listName: "List", found: 5-index, weak: index > 2, confidence: [62, 30, 5, 2, 1, 0][index]!, notes: index ? [] : ["Sent 1 day before the slip", "Supplier named on the slip"]}));
  const fetcher = vi.fn(async () => Response.json(rows));
  const select = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<OrderMatchCandidates jobId="job" documentId="doc" readingKey="ready" selectedId="o0" onSelect={select} />);
  const first = await screen.findByRole("button", {name: "Compare rank 1: PO-0"});
  expect(first).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("button")).toHaveLength(5);
  expect(first).toHaveTextContent("62% match confidence · 5 products found");
  expect(first).toHaveTextContent("Sent 1 day before the slip · Supplier named on the slip");
  expect(screen.getAllByText(/Weak match — check carefully/)).toHaveLength(2);
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
it("names the one order at 90% match confidence, and none when two are close", async () => {
  const row = (orderId: string, confidence: number) => ({orderId, orderNumber: orderId, supplier: null, listName: "List", sentAt: null, found: 3, weak: false, confidence});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([row("sure", 94), row("other", 5)])));
  const sure = vi.fn();
  render(<OrderMatchCandidates jobId="job" documentId="doc" readingKey="ready" selectedId="" onSelect={vi.fn()} onSure={sure} />);
  await screen.findByText(/94% match confidence/);
  expect(sure).toHaveBeenCalledWith("sure");
  expect(sureOrder([row("a", 90), row("b", 91)])).toBeNull();
  expect(sureOrder([row("a", 89)])).toBeNull();
});
