import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { DrawingMarkup, DrawingMarkupLink } from "~/lib/drawing-workspace";

const mock = vi.hoisted(() => ({
  state: { data: undefined as unknown, isLoading: false, error: null as null | { message: string } },
  input: null as unknown,
  refetch: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      equipmentTag: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          mock.input = input;
          return options.enabled ? { ...mock.state, refetch: mock.refetch } : { data: undefined, isLoading: false, error: null, refetch: mock.refetch };
        },
      },
    },
  },
}));
import { EquipmentTagDestinations, equipmentKind } from "./EquipmentTagDestinations";

afterEach(() => {
  cleanup();
  mock.state = { data: undefined, isLoading: false, error: null };
});

const markup = {
  type: "link",
  equipmentTag: "P-1",
  points: [
    { x: 0.2, y: 0.3 },
    { x: 0.25, y: 0.32 },
  ],
} as unknown as DrawingMarkup;
const saved: DrawingMarkupLink[] = [
  { label: "P-1 — M-601", url: "/old" },
  { label: "Pump photo", url: "/photo" },
];
const show = (online = true) => {
  const chosen: DrawingMarkupLink[] = [];
  const renderLink = (link: DrawingMarkupLink, content: ReactNode, key: string) => (
    <button key={key} onClick={() => chosen.push(link)}>
      {content}
    </button>
  );
  render(<EquipmentTagDestinations sheetId="s1" markup={markup} saved={saved} online={online} renderLink={renderLink} />);
  return chosen;
};

it("names the equipment from its schedule title", () => {
  expect(equipmentKind("PUMP SCHEDULE")).toBe("Pump");
  expect(equipmentKind("FAN COIL UNIT SCHEDULE (CONT.)")).toBe("Fan coil unit");
  expect(equipmentKind("MECHANICAL EQUIPMENT SCHEDULE")).toBe("");
});

it("groups every place a tag appears and keeps hand-added links", () => {
  mock.state.data = {
    tag: "P-1",
    schedules: [{ title: "PUMP SCHEDULE", cells: ["BASE MOUNTED", "150 GPM", "60 FT"], source: "M-601", url: "/schedule" }],
    drawings: [
      { sheetId: "s1", setName: "IFC", name: "M-101", here: true, links: [{ label: "a", url: "/here" }] },
      { sheetId: "s2", setName: "IFC", name: "M-201", here: false, links: [{ label: "b", url: "/b1" }, { label: "c", url: "/b2" }] },
    ],
    documents: [{ documentId: "d1", name: "Pump submittal", pages: [3, 4], url: "/doc" }],
    warnings: [],
    pending: 0,
  };
  const chosen = show();
  expect(mock.input).toEqual({ sheetId: "s1", tag: "P-1", exclude: { left: 0.2, right: 0.25, top: 0.3, bottom: 0.32 } });
  expect(screen.getByText("Pump")).toBeTruthy();
  expect(screen.getByText("BASE MOUNTED · 150 GPM · 60 FT")).toBeTruthy();
  expect(screen.getByText("M-101 (this sheet)")).toBeTruthy();
  expect(screen.getByText("IFC · 2 places")).toBeTruthy();
  expect(screen.getByText("Pages 3, 4")).toBeTruthy();
  // The scan's saved snapshot link is superseded; the photo is not.
  expect(screen.queryByText("P-1 — M-601")).toBeNull();
  fireEvent.click(screen.getByText("Pump photo"));
  fireEvent.click(screen.getByText("2"));
  expect(chosen.map((link) => link.url)).toEqual(["/photo", "/b2"]);
});

it("falls back to saved links offline and reports files still being read", () => {
  show(false);
  expect(screen.getByText(/Offline/)).toBeTruthy();
  expect(screen.getByText("P-1 — M-601")).toBeTruthy();
  cleanup();
  mock.state.data = { tag: "P-1", schedules: [], drawings: [], documents: [], warnings: [], pending: 2 };
  show();
  expect(screen.getByText(/does not appear anywhere else/)).toBeTruthy();
  fireEvent.click(screen.getByText("Search again"));
  expect(mock.refetch).toHaveBeenCalled();
});
