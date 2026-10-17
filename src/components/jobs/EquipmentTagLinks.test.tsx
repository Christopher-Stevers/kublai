import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { EquipmentTagLinks } from "./EquipmentTagLinks";
const word = { text: "HEX-2", left: 0.2, top: 0.2, right: 0.25, bottom: 0.23 };
const points = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.5 },
];
const onAdd = vi.fn(() => 1),
  onBusy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mock.sources.mockResolvedValue({
    sources: [{ kind: "document", id: "doc", name: "HEX-2 datasheet" }],
  });
  mock.matches.mockResolvedValue({
    results: [
      {
        source: { name: "HEX-2 datasheet" },
        links: [
          {
            label: "HEX-2 datasheet",
            url: "/dashboard/jobs/alma/documents?document=doc",
          },
        ],
        warnings: [],
        overflow: false,
      },
    ],
  });
});
afterEach(cleanup);
it("automatically searches one detected tag and adds the related links to the draft", async () => {
  render(
    <EquipmentTagLinks
      id="draft"
      sheetId="sheet"
      points={points}
      readWords={() => Promise.resolve([word])}
      onAdd={onAdd}
      onBusy={onBusy}
      offline={false}
    />,
  );
  await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
  expect(mock.matches).toHaveBeenCalledWith(
    expect.objectContaining({ tag: "HEX-2" }),
    expect.anything(),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 related destination added",
  );
  expect(onBusy).toHaveBeenLastCalledWith(false);
});
it("requires a tag choice when the selected area contains more than one tag", async () => {
  render(
    <EquipmentTagLinks
      id="draft"
      sheetId="sheet"
      points={points}
      readWords={() =>
        Promise.resolve([
          word,
          { ...word, text: "FCU-1", left: 0.3, right: 0.35 },
        ])
      }
      onAdd={onAdd}
      onBusy={onBusy}
      offline={false}
    />,
  );
  await screen.findByText(
    "Several tags were found. Choose the equipment tag below.",
  );
  expect(mock.sources).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Equipment tag"), {
    target: { value: "FCU-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search links" }));
  await waitFor(() =>
    expect(mock.matches).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "FCU-1" }),
      expect.anything(),
    ),
  );
});
it("does not change a closed draft when an outstanding request finishes", async () => {
  let finish!: (value: unknown) => void;
  mock.matches.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <EquipmentTagLinks
      id="draft"
      sheetId="sheet"
      points={points}
      readWords={() => Promise.resolve([word])}
      onAdd={onAdd}
      onBusy={onBusy}
      offline={false}
    />,
  );
  await waitFor(() => expect(mock.matches).toHaveBeenCalledOnce());
  view.unmount();
  finish({ results: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onAdd).not.toHaveBeenCalled();
});
it("searches a large drawing set in bounded batches rather than a request per page", async () => {
  mock.sources.mockResolvedValue({
    sources: Array.from({ length: 82 }, (_, n) => ({
      kind: "drawing",
      id: String(n),
      name: `M-${n}`,
    })),
  });
  mock.matches.mockResolvedValue({ results: [] });
  render(
    <EquipmentTagLinks
      id="batch"
      sheetId="sheet"
      points={points}
      readWords={() => Promise.resolve([word])}
      onAdd={onAdd}
      onBusy={onBusy}
      offline={false}
    />,
  );
  await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
  expect(
    mock.matches.mock.calls.map(
      (call) => (call[0] as { sources: unknown[] }).sources.length,
    ),
  ).toEqual([32, 32, 18]);
});
