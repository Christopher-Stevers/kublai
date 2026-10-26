import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ sources: vi.fn(), preview: vi.fn() }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      drawingsWorkspace: {
        autoHyperlinkSources: { fetch: mock.sources },
        autoHyperlinkPreview: { fetch: mock.preview },
      },
    }),
  },
}));
import { AutoHyperlinkDialog } from "./AutoHyperlinkDialog";
import type { DrawingEntity, DrawingSave } from "~/lib/drawing-workspace";
const word = { text: "HEX-2", left: 0.2, right: 0.25, top: 0.3, bottom: 0.32 };
const save = vi.fn<(value: DrawingSave) => Promise<unknown>>(),
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
    knownTags: [],
    sheetNumbers: [],
    warnings: [],
  });
  mock.preview.mockImplementation(async ({ tags }: { tags: string[] }) => ({
    results: tags.map((tag) => ({
      tag,
      links: [{ label: `${tag} schedule`, url: `/drawings/${tag}` }],
      overflow: false,
      drawings: 1,
      documents: 0,
    })),
    warnings: [],
    pending: 0,
  }));
  save.mockResolvedValue({});
});
afterEach(cleanup);
it("previews all tags in one job-wide request, then saves only the selected tags", async () => {
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("HEX-2");
  expect(save).not.toHaveBeenCalled();
  expect(mock.preview).toHaveBeenCalledWith(
    { sheetId: uuid(1), tags: ["HEX-2", "FCU-1"], scope: "job" },
    { staleTime: 0 },
  );
  fireEvent.click(screen.getByLabelText("Link FCU-1"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected links (1)" }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]![0]).toMatchObject({
    visibility: "private",
    data: {
      equipmentTag: "HEX-2",
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.25, y: 0.32 },
      ],
    },
  });
});
it("keeps existing tags and links repeated occurrences through one saved origin", async () => {
  const input = props();
  input.entities = [
    {
      visibility: "private",
      kind: "markup",
      data: { sourceSheetId: uuid(2), equipmentTag: "FCU-1" },
    },
  ] as DrawingEntity[];
  readWords.mockResolvedValue([
    word,
    { ...word, left: 0.6, right: 0.65 },
    { ...word, text: "FCU-1", top: 0.5, bottom: 0.52 },
  ]);
  render(<AutoHyperlinkDialog {...input} />);
  await screen.findByText("HEX-2");
  expect(screen.getByLabelText("Link FCU-1")).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected links (1)" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    data: {
      links: expect.arrayContaining([
        expect.objectContaining({ url: expect.stringContaining("#snapshot=") }),
      ]),
    },
  });
});
it("does not save incomplete indexing or over-limit destination lists", async () => {
  mock.preview.mockResolvedValue({
    results: [
      {
        tag: "HEX-2",
        links: [{ label: "Schedule", url: "/sheet" }],
        overflow: false,
      },
    ],
    warnings: ["Still indexing"],
    pending: 1,
  });
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("HEX-2");
  expect(
    screen.getByRole("button", { name: "Save selected links (1)" }),
  ).toBeDisabled();
  mock.preview.mockResolvedValue({
    results: [
      {
        tag: "HEX-2",
        links: [{ label: "Schedule", url: "/sheet" }],
        overflow: true,
      },
    ],
    warnings: [],
    pending: 0,
  });
  fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
  await screen.findByText(/Too many destinations/);
  expect(screen.getByLabelText("Link HEX-2")).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
it("retries failed saves without duplicating successful tags", async () => {
  save.mockRejectedValueOnce(Error("Conflict"));
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("HEX-2");
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected links (2)" }),
  );
  await screen.findByRole("alert");
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected links (1)" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(
    save.mock.calls.map(([v]) =>
      v.kind === "markup" ? v.data.equipmentTag : null,
    ),
  ).toEqual(["HEX-2", "FCU-1", "HEX-2"]);
});
it("shows missing readable text and performs no destination search", async () => {
  readWords.mockResolvedValue([]);
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText(/No readable text found/);
  expect(mock.preview).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("stops a scan without saving or displaying its late results", async () => {
  let finish: (value: unknown) => void = () => {};
  mock.preview.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() => expect(mock.preview).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  finish({
    results: [{ tag: "HEX-2", links: [], overflow: false }],
    warnings: [],
    pending: 0,
  });
  await waitFor(() => expect(screen.queryByText("HEX-2")).toBeNull());
  expect(save).not.toHaveBeenCalled();
});
