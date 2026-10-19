import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ sources: vi.fn(), matches: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      drawingsWorkspace: {
        equipmentSources: { fetch: mock.sources },
        equipmentMatchesBatch: { fetch: mock.matches },
      },
    }),
  },
}));
import { AutoHyperlinkDialog } from "./AutoHyperlinkDialog";
import type { DrawingEntity } from "~/lib/drawing-workspace";
const word = { text: "HEX-2", left: 0.2, right: 0.25, top: 0.3, bottom: 0.32 };
const save = vi.fn(),
  onSaved = vi.fn(),
  readWords = vi.fn();
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const props = () => ({
  sheetId: uuid(1),
  sourceId: uuid(2),
  jobId: uuid(3),
  setId: uuid(4),
  name: "M-1",
  visibility: "private" as const,
  entities: [] as DrawingEntity[],
  readWords,
  save,
  onClose: vi.fn(),
  onSaved,
});
beforeEach(() => {
  vi.clearAllMocks();
  readWords.mockResolvedValue([
    word,
    { ...word, text: "FCU-1", top: 0.5, bottom: 0.52 },
  ]);
  mock.sources.mockResolvedValue({
    sources: [{ kind: "document", id: "doc", name: "datasheet" }],
  });
  mock.matches.mockImplementation(async ({ tag }: { tag: string }) => ({
    results: [
      {
        source: { name: "datasheet" },
        links: [{ label: tag, url: `/documents/${tag}` }],
        warnings: [],
        overflow: false,
      },
    ],
  }));
  save.mockResolvedValue({});
});
afterEach(cleanup);
it("scans every distinct tag and saves automatic links without requiring a drawn box", async () => {
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finished. 2 tags linked",
    ),
  );
  expect(save.mock.calls.map((call) => call[0].data.equipmentTag)).toEqual([
    "HEX-2",
    "FCU-1",
  ]);
  expect(save.mock.calls[0]![0].data.points).toEqual([
    { x: 0.2, y: 0.3 },
    { x: 0.25, y: 0.32 },
  ]);
  expect(onSaved).toHaveBeenCalledOnce();
});
it("links repeated occurrences on this page through one origin, preserving existing tags", async () => {
  readWords.mockResolvedValue([
    word,
    { ...word, left: 0.6, right: 0.65 },
    { ...word, text: "FCU-1", top: 0.5, bottom: 0.52 },
  ]);
  const input = props();
  input.entities = [
    {
      visibility: "private",
      kind: "markup",
      data: { sourceSheetId: uuid(2), equipmentTag: "FCU-1" },
    },
  ] as DrawingEntity[];
  render(<AutoHyperlinkDialog {...input} />);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 tags linked, 1 already linked",
    ),
  );
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]![0].data.links).toHaveLength(2);
  expect(save.mock.calls[0]![0].data.links[0].url).toContain("snapshot=");
});
it("does not save an incomplete search when a batch fails, and reports the failure", async () => {
  mock.matches.mockRejectedValue(new Error("Access changed"));
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByRole("button", { name: "Done" });
  expect(save).not.toHaveBeenCalled();
  expect(screen.getAllByText(/Access changed/)).toHaveLength(2);
});
it("stopping during a pending match prevents that tag from being saved", async () => {
  let resolve!: (value: unknown) => void;
  mock.matches.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() => expect(mock.matches).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  resolve({
    results: [{ links: [{ url: "/doc" }], warnings: [], overflow: false }],
  });
  await screen.findByRole("button", { name: "Done" });
  expect(save).not.toHaveBeenCalled();
  expect(mock.matches).toHaveBeenCalledOnce();
});
it("reports scanned/unreadable drawings without creating empty links", async () => {
  readWords.mockResolvedValue([]);
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "No readable equipment tags",
    ),
  );
  expect(save).not.toHaveBeenCalled();
  expect(mock.sources).not.toHaveBeenCalled();
});
it("continues after a failed save and reports it without counting it as linked", async () => {
  save.mockRejectedValueOnce(new Error("Read only"));
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finished. 1 tags linked",
    ),
  );
  expect(screen.getByText(/could not save — Read only/)).toBeInTheDocument();
});
