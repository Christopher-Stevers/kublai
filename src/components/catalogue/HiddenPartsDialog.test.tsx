import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HiddenPartsDialog, type HideSource } from "./HiddenPartsDialog";
import type { CatalogueHideRule } from "~/lib/catalogue-hidden";

const state = vi.hoisted(() => ({
  hide: vi.fn(),
  show: vi.fn(),
  setData: vi.fn(),
  hideOptions: null as null | { onSuccess: (data: { rules: unknown[] }) => void },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ catalogue: { getHiddenParts: { setData: state.setData } } }),
    catalogue: {
      hideParts: { useMutation: (options: typeof state.hideOptions) => { state.hideOptions = options; return { mutate: state.hide, isPending: false }; } },
      showHiddenParts: { useMutation: () => ({ mutate: state.show, isPending: false }) },
    },
  },
}));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: vi.fn() }));

const ids = {
  plumbing: "00000000-0000-4000-8000-000000000001",
  copper: "00000000-0000-4000-8000-000000000003",
  pex: "00000000-0000-4000-8000-000000000004",
  elbows: "00000000-0000-4000-8000-000000000005",
};
const part = (id: string, materialId: string, sizeNominal: string) => ({
  id, displayName: `Part ${id}`, catalogId: ids.plumbing, materialId, sizeNominal, sizeUnit: "in", categoryId: ids.elbows,
});
const parts = [part("1", ids.copper, "0.5"), part("2", ids.copper, "0.75"), part("3", ids.pex, "0.5")];
const source: HideSource = {
  catalogs: [{ id: ids.plumbing, name: "Plumbing" }],
  materials: [{ id: ids.copper, name: "Copper" }, { id: ids.pex, name: "PEX" }],
  categories: [{ id: ids.elbows, name: "Elbows" }],
  parts,
  namedParts: parts,
};
const view = (rules: CatalogueHideRule[] = [], props: Partial<Parameters<typeof HiddenPartsDialog>[0]> = {}) =>
  render(<HiddenPartsDialog open onOpenChange={vi.fn()} source={source} rules={rules} initial={{}} {...props} />);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("hides parts from lists by any mix of criteria, offering only what fits the choices above", () => {
  view([], { initial: { catalogId: ids.plumbing } });
  expect(screen.getByRole("dialog", { name: "Hide from material lists" })).toHaveTextContent("The Catalogue still shows every part.");
  expect(screen.getByRole("status")).toHaveTextContent("Hides 3 parts");
  fireEvent.change(screen.getByLabelText("Material"), { target: { value: ids.copper } });
  const size = screen.getByLabelText("Size");
  expect(within(size).getAllByRole("option").map((o) => o.textContent)).toEqual(["Any size", '1/2" (1)', '3/4" (1)']);
  fireEvent.change(size, { target: { value: "0.5|in" } });
  expect(screen.getByRole("status")).toHaveTextContent("Hides 1 part");
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(state.hide).toHaveBeenCalledWith({ criteria: { catalogId: ids.plumbing, materialId: ids.copper, size: { nominal: 0.5, unit: "in" } } });
  const rules = [{ id: "r", materialId: ids.copper }];
  state.hideOptions!.onSuccess({ rules });
  expect(state.setData).toHaveBeenCalledWith(undefined, { rules });
});

it("needs at least one choice and can hide a single part", () => {
  view();
  expect(screen.getByRole("button", { name: "Hide" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Part"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(state.hide).toHaveBeenCalledWith({ criteria: { partId: "3" } });
});

it("lists what is hidden and offers it again", () => {
  view([{ id: "r1", materialId: ids.copper, size: { nominal: 0.5, unit: "in" } }]);
  const list = screen.getByRole("region", { name: "Hidden from lists" });
  expect(list).toHaveTextContent('Copper · 1/2"');
  expect(list).toHaveTextContent("1 part");
  fireEvent.click(within(list).getByRole("button", { name: 'Unhide Copper · 1/2"' }));
  expect(state.show).toHaveBeenCalledWith({ ruleId: "r1" });
});
