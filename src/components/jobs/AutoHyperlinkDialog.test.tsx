import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  targets: vi.fn(),
  sources: vi.fn(),
  preview: vi.fn(),
  readers: vi.fn(),
  detect: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      autoHyperlinkDetect: {
        useMutation: () => ({ mutateAsync: mock.detect }),
      },
    },
    useUtils: () => ({
      drawingsWorkspace: {
        autoHyperlinkTargets: { fetch: mock.targets },
        autoHyperlinkSources: { fetch: mock.sources },
        autoHyperlinkPreview: { fetch: mock.preview },
        autoHyperlinkReaders: { fetch: mock.readers },
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
  mock.targets.mockResolvedValue({drawings:[{id:uuid(1),name:"M-1",setId:uuid(4),setName:"Mechanical"},{id:uuid(8),name:"A-1",setId:uuid(9),setName:"Architectural"}], documents:[{id:uuid(10),name:"Pump submittal.pdf",folderId:uuid(11)}], folders:[{id:uuid(11),name:"Submittals",parentId:null}]});
  mock.readers.mockResolvedValue({
    normal: { available: true },
    terra: { available: true },
  });
  mock.detect.mockResolvedValue({
    reader: "terra",
    model: "fixture",
    tags: [
      {
        tag: "HEX-2",
        boxes: [word, { ...word, left: 0.6, right: 0.65 }],
        needsPositionReview: true,
      },
    ],
    warnings: [],
    cached: false,
  });
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
    { sheetId: uuid(1), tags: ["HEX-2", "FCU-1"], scope: "job", drawingIds: [], documentIds: [] },
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
      fill: "#00c9ad",
      stroke: "#00c9ad",
      opacity: 0.55,
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
  fireEvent.change(screen.getByLabelText("Hyperlink highlight colour"), { target: { value: "#8844ff" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected links (1)" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const saved = save.mock.calls[0]![0];
  if (saved.kind !== "markup") throw Error("Expected hyperlink markup");
  expect(saved.data).toMatchObject({ fill: "#8844ff", stroke: "#8844ff" });
  expect(
    saved.data.links?.some((link) => link.url?.includes("#snapshot=")),
  ).toBe(true);
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
  let finish: (value: unknown) => void = () => undefined;
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
it.each(["terra"])(
  "uses the selected %s reader only after an explicit scan and saves reviewed positions",
  async (reader) => {
    readWords.mockResolvedValue([]);
    render(<AutoHyperlinkDialog {...props()} />);
    await screen.findByText(/No readable text found/);
    fireEvent.change(screen.getByLabelText("Auto Hyperlink version"), {
      target: { value: reader },
    });
    expect(mock.detect).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Scan with Terra`,
      }),
    );
    await screen.findByText("HEX-2");
    expect(mock.detect).toHaveBeenCalledWith(
      expect.objectContaining({
        reader,
        sheetId: uuid(1),
        sourceSheetId: uuid(2),
        refresh: false,
      }),
    );
    expect(screen.getByLabelText("Link HEX-2")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save selected links (0)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Review tag location" }),
    ).toHaveAttribute("href", expect.stringContaining("#snapshot="));
    fireEvent.click(screen.getByLabelText("Link HEX-2"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save selected links (1)" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0]).toMatchObject({
      data: {
        hyperlinkReader: reader,
        equipmentTagBoxes: [
          { left: 0.2, right: 0.25, top: 0.3, bottom: 0.32 },
          { left: 0.6, right: 0.65, top: 0.3, bottom: 0.32 },
        ],
      },
    });
  },
);
it("shows a disconnected provider without quietly substituting Normal", async () => {
  mock.readers.mockResolvedValue({
    terra: { available: false },
  });
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("HEX-2");
  fireEvent.change(screen.getByLabelText("Auto Hyperlink version"), {
    target: { value: "terra" },
  });
  await screen.findByText(/Terra is not connected yet/);
  expect(
    screen.getByRole("button", { name: "Scan with Terra" }),
  ).toBeDisabled();
  expect(screen.queryByText("HEX-2")).toBeNull();
  expect(mock.detect).not.toHaveBeenCalled();
});
it("can explicitly reread an empty cached AI result", async () => {
  mock.detect.mockResolvedValue({
    tags: [],
    warnings: ["No clear tags"],
    cached: true,
  });
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("HEX-2");
  fireEvent.change(screen.getByLabelText("Auto Hyperlink version"), {
    target: { value: "terra" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Scan with Terra" }));
  await screen.findByText(/No drawing tags identified/);
  fireEvent.click(screen.getByRole("button", { name: "Read again" }));
  await waitFor(() => expect(mock.detect).toHaveBeenCalledTimes(2));
  expect(mock.detect.mock.calls[1]![0]).toMatchObject({
    reader: "terra",
    refresh: true,
  });
});
it("clears results when switching versions and ignores a stopped AI response", async () => {
  let finish!: (value: unknown) => void;
  mock.detect.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("HEX-2");
  fireEvent.change(screen.getByLabelText("Auto Hyperlink version"), {
    target: { value: "terra" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Scan with Terra" }));
  await waitFor(() => expect(mock.detect).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  fireEvent.change(screen.getByLabelText("Auto Hyperlink version"), {
    target: { value: "normal" },
  });
  finish({
    tags: [{ tag: "OLD-1", boxes: [word], needsPositionReview: true }],
    warnings: [],
  });
  await waitFor(() => expect(screen.queryByText("OLD-1")).toBeNull());
  expect(save).not.toHaveBeenCalled();
});

it("searches only chosen sheets and files and clears stale results when selection changes", async () => {
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() => expect(mock.preview).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Hyperlink search scope"), {target: {value: "custom"}});
  await screen.findByLabelText("Select all in Mechanical");
  expect(screen.getByRole("button", {name: "Scan again"})).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Select all in Mechanical"));
  fireEvent.click(screen.getByLabelText("Pump submittal.pdf"));
  fireEvent.click(screen.getByRole("button", {name: "Scan again"}));
  await waitFor(() => expect(mock.preview).toHaveBeenLastCalledWith(expect.objectContaining({scope: "custom", drawingIds: [uuid(1)], documentIds: [uuid(10)]}), {staleTime: 0}));
  fireEvent.click(screen.getByRole("button", {name: "Clear sources"}));
  expect(screen.getByRole("button", {name: /Save Selected Links \(0\)/i})).toBeDisabled();
});

it("does not add same-sheet links to a documents-only search", async () => {
  readWords.mockResolvedValue([word, {...word,left: .6,right:.65}]);
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() => expect(mock.preview).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Hyperlink search scope"), {target: {value: "documents"}});
  fireEvent.click(screen.getByRole("button", {name: "Scan again"}));
  await waitFor(() => expect(mock.preview).toHaveBeenLastCalledWith(expect.objectContaining({scope: "documents"}), {staleTime: 0}));
  fireEvent.click(screen.getByRole("button", {name: /Save Selected Links/i}));
  await waitFor(() => expect(save).toHaveBeenCalled());
  for(const [value] of save.mock.calls) expect(JSON.stringify(value)).not.toContain('#snapshot=');
});
it("selects nested folder files and permits individual exclusions", async () => {
  mock.targets.mockResolvedValue({drawings: [], documents: [{id:uuid(10),name:"Pump.pdf",folderId:uuid(12)},{id:uuid(13),name:"Fan.pdf",folderId:uuid(12)}], folders:[{id:uuid(11),name:"Submittals",parentId:null},{id:uuid(12),name:"Approved",parentId:uuid(11)}]});
  render(<AutoHyperlinkDialog {...props()} />);
  await waitFor(() => expect(mock.preview).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Hyperlink search scope"), {target:{value:"custom"}});
  fireEvent.click(await screen.findByLabelText("Select all in Submittals"));
  expect(screen.getByText(/2 documents selected/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByLabelText("Fan.pdf")[0]!);
  fireEvent.click(screen.getByRole("button", {name:"Scan again"}));
  await waitFor(() => expect(mock.preview).toHaveBeenLastCalledWith(expect.objectContaining({drawingIds:[],documentIds:[uuid(10)]}), {staleTime:0}));
});
it("previews and saves non-equipment references while leaving short labels for explicit review", async () => {
  readWords.mockResolvedValue([word,{...word,text:"D101",top:.4,bottom:.42},{...word,text:"ROOM 101",top:.5,bottom:.52},{...word,text:"1/M501",top:.6,bottom:.62}]);
  render(<AutoHyperlinkDialog {...props()} />);
  await screen.findByText("D-101");
  expect(mock.preview.mock.calls[0]![0].tags).toEqual(expect.arrayContaining(["HEX-2","D-101","101","1/M-501"]));
  expect(screen.getByLabelText("Link 101")).not.toBeChecked();
  expect(screen.getByLabelText("Link D-101")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Link 101"));
  fireEvent.click(screen.getByRole("button", {name: "Save selected links (4)"}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalled());
  expect(save.mock.calls.map(([value])=>value.kind === "markup" ? value.data.equipmentTag : "")).toEqual(expect.arrayContaining(["D-101","101","1/M-501"]));
});
