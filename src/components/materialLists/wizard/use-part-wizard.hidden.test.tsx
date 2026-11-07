import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePartWizard } from "./use-part-wizard";
import type { CatalogueHideRule } from "~/lib/catalogue-hidden";

const ids = {
  plumbing: "00000000-0000-4000-8000-000000000001",
  hvac: "00000000-0000-4000-8000-000000000002",
  copper: "00000000-0000-4000-8000-000000000003",
  pex: "00000000-0000-4000-8000-000000000004",
  elbows: "00000000-0000-4000-8000-000000000005",
};
const fixtures = vi.hoisted(() => ({ rules: [] as CatalogueHideRule[], cache: null as unknown }));
const part = (id: string, catalogId: string, materialId: string, sizeNominal: string) => ({
  id, displayName: id, description: null, imageUrl: null, material: null, materialId,
  size: null, sizeLabel: null, sizeNominal, sizeUnit: "in", catalogId, categoryId: ids.elbows, isOrgSpecific: true,
});
fixtures.cache = {
  catalogs: [
    { id: ids.plumbing, name: "Plumbing", kind: "materials", sortOrder: 0 },
    { id: ids.hvac, name: "HVAC", kind: "materials", sortOrder: 1 },
  ],
  materials: [{ id: ids.copper, name: "Copper" }, { id: ids.pex, name: "PEX" }],
  categories: [{ id: ids.elbows, name: "Elbows", sortOrder: 0 }],
  allUnits: [],
  parts: [
    part("copper-half", ids.plumbing, ids.copper, "0.5"),
    part("copper-three-quarter", ids.plumbing, ids.copper, "0.75"),
    part("pex-half", ids.plumbing, ids.pex, "0.5"),
    part("duct", ids.hvac, ids.copper, "6"),
  ],
};
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({ useTutorialSandbox: () => false }));
vi.mock("~/hooks/use-replicache-catalogue", () => ({ useReplicacheCatalogue: () => fixtures.cache }));
vi.mock("~/lib/replicache-catalogue", () => ({ requestCatalogueReplicachePull: vi.fn() }));
vi.mock("~/lib/snapshot-source", () => ({ currentSnapshotState: () => null }));
vi.mock("~/components/chat/SnapshotSourceContext", () => ({ useSnapshotSource: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
  useUtils: () => ({ catalogue: {} }),
  catalogue: {
    getHiddenParts: { useQuery: () => ({ data: { rules: fixtures.rules } }) },
    getPartWizardSummary: { useQuery: () => ({ data: undefined, isPending: false, error: null }) },
    searchParts: { useQuery: () => ({ data: undefined, isPending: false, error: null }) },
    createCatalog: { useMutation: () => ({}) }, createMaterial: { useMutation: () => ({}) },
    createSize: { useMutation: () => ({}) }, createCategoryType: { useMutation: () => ({}) },
  },
} }));
afterEach(() => { cleanup(); fixtures.rules = []; });

const browse = (result: { current: ReturnType<typeof usePartWizard> }) => {
  act(() => result.current.handleCatalogSelect(null));
  act(() => result.current.handleMaterialSelect(null));
  act(() => result.current.handleSizeSelect(null));
  act(() => result.current.handleCategorySelection({ categoryId: null, name: "All Categories" }));
  return result.current.filteredPartsForSelection.map((p) => p.id);
};

const useAdding = () => usePartWizard(true, undefined, undefined, "materials", undefined, false, true);

it("leaves out of adding parts those matching every criterion of a rule, by catalogue, material, size or one part", () => {
  fixtures.rules = [
    { id: "a", catalogId: ids.plumbing, materialId: ids.copper, size: { nominal: 0.5, unit: "in" } },
    { id: "b", partId: "00000000-0000-4000-8000-00000000000f" },
  ];
  const cache = fixtures.cache as { parts: Array<{ id: string }> };
  cache.parts[3]!.id = "00000000-0000-4000-8000-00000000000f";
  try {
    const { result } = renderHook(useAdding);
    expect(result.current.catalogsWithCounts.map((c) => [c.name, c.count])).toEqual([["Plumbing", 2]]);
    expect(browse(result).sort()).toEqual(["copper-three-quarter", "pex-half"]);
    act(() => result.current.returnToStage("catalog"));
    act(() => result.current.setWizardSearchQuery("copper"));
    expect(result.current.filteredPartsForSelection.map((p) => p.id)).toEqual(["copper-three-quarter"]);
  } finally { cache.parts[3]!.id = "duct"; }
});

it("hides a whole material when adding, and the Catalogue still shows every part", () => {
  fixtures.rules = [{ id: "a", materialId: ids.copper }];
  const { result } = renderHook(useAdding);
  expect(result.current.catalogsWithCounts.map((c) => c.name)).toEqual(["Plumbing"]);
  act(() => result.current.handleCatalogSelect(ids.plumbing));
  expect(result.current.materialsWithCounts.map((m) => m.name)).toEqual(["PEX"]);
  const catalogue = renderHook(() => usePartWizard()).result;
  expect(catalogue.current.catalogsWithCounts.map((c) => c.name)).toEqual(["Plumbing", "HVAC"]);
  expect(catalogue.current.hiddenRules).toEqual(fixtures.rules);
  expect(catalogue.current.hideSource.parts).toHaveLength(4);
});
