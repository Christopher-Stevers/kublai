import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PartDetailsDialog } from "./PartDetailsDialog";

const editState = vi.hoisted(() => ({ part: undefined as Record<string, unknown> | undefined, save: vi.fn(), create: vi.fn() }));
const familyState = vi.hoisted(() => ({
  lastInput: undefined as { mode?: string } | undefined,
  data: undefined as
    | {
        familyLabel: string;
        suggestions: Array<{
          id: string;
          displayName: string;
          description: string | null;
          imageUrl: string | null;
          material: string | null;
          size: string | null;
        }>;
      }
    | undefined,
}));
afterEach(() => cleanup());

// These UI tests do not exercise IndexedDB synchronization.
vi.mock("~/lib/replicache-catalogue", () => ({
  requestCatalogueReplicachePull: vi.fn(),
}));

type Catalog = {
  id: string;
  name: string;
  sortOrder?: number;
  organizationId?: string;
  partCount?: number;
};
type Material = { id: string; name: string };
type Category = {
  id: string;
  name: string;
  sortOrder?: number;
  organizationId?: string;
  partCount?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __partDialogMockData: {
    catalogs: Catalog[];
    materials: Material[];
    categories: Category[];
    units: Array<{
      id: string;
      code: string;
      displayName: string;
      kind: string;
    }>;
  };
}

globalThis.__partDialogMockData = {
  catalogs: [],
  materials: [],
  categories: [],
  units: [{ id: "u-in", code: "in", displayName: "Inches", kind: "length" }],
};

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
}));

vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("~/components/suppliers/SupplierFormDialog", () => ({
  SupplierFormDialog: () => null,
}));

vi.mock("~/components/catalogue/PartSuppliersDropdown", () => ({
  PartSuppliersDropdown: () => null,
}));

vi.mock("~/trpc/react", () => {
  const makeResult = <T,>(data: T) => ({ data, isLoading: false });

  return {
    api: {
      useUtils: () => ({
        catalogue: {
          getCatalogs: {
            setData: (
              _key: unknown,
              updater: (old: Catalog[] | undefined) => Catalog[] | undefined,
            ) => {
              globalThis.__partDialogMockData.catalogs =
                updater(globalThis.__partDialogMockData.catalogs) ?? [];
            },
            invalidate: vi.fn(),
          },
          getCategoryTree: {
            setData: (
              _key: unknown,
              updater: (old: Category[] | undefined) => Category[] | undefined,
            ) => {
              globalThis.__partDialogMockData.categories =
                updater(globalThis.__partDialogMockData.categories) ?? [];
            },
            invalidate: vi.fn(),
          },
          getMaterials: {
            setData: (
              _key: unknown,
              updater: (old: Material[] | undefined) => Material[] | undefined,
            ) => {
              globalThis.__partDialogMockData.materials =
                updater(globalThis.__partDialogMockData.materials) ?? [];
            },
            invalidate: vi.fn(),
          },
          getAvailableSizes: { invalidate: vi.fn() },
          searchParts: { invalidate: vi.fn() },
          getPart: { invalidate: vi.fn() },
          getPartWizardSummary: { invalidate: vi.fn() },
        },
        supplier: {
          getSupplierPartsByPart: { fetch: vi.fn().mockResolvedValue([]) },
        },
      }),
      catalogue: {
        getQuantityUnits: {useQuery: () => ({data:[], refetch:vi.fn().mockResolvedValue({})})},
        createQuantityUnit: {useMutation: () => ({mutateAsync:vi.fn().mockResolvedValue({})})},
        getPart: { useQuery: () => ({ data: editState.part, isLoading: false }) },
        getCatalogs: {
          useQuery: () => makeResult(globalThis.__partDialogMockData.catalogs),
        },
        getMaterials: {
          useQuery: () => makeResult(globalThis.__partDialogMockData.materials),
        },
        getCategoryTree: {
          useQuery: () =>
            makeResult(globalThis.__partDialogMockData.categories),
        },
        getAllUnits: {
          useQuery: () => makeResult(globalThis.__partDialogMockData.units),
        },
        getPartsSupplierInfo: {
          useQuery: () => ({ data: {}, isLoading: false }),
        },
        getPartImageFamilySuggestions: {
          useQuery: (input: { mode?: string }, opts?: { enabled?: boolean }) => {
            familyState.lastInput = input;
            return {
              data: opts?.enabled ? familyState.data : undefined,
              isLoading: false,
              isFetching: false,
            };
          },
        },
        applyGooglePartImage: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        applyPartImageToFamilyCandidate: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: vi.fn().mockResolvedValue({
              id: "part-target",
              imageUrl: "/api/catalogue/images/part-source.webp",
            }),
          }),
        },
        createCatalog: {
          useMutation: (opts: { onSuccess?: (value: Catalog) => void }) => ({
            isPending: false,
            mutate: ({ name }: { name: string }) => {
              const created = { id: `catalog-${name.toLowerCase()}`, name };
              globalThis.__partDialogMockData.catalogs = [
                ...globalThis.__partDialogMockData.catalogs,
                created,
              ];
              opts.onSuccess?.(created);
            },
          }),
        },
        createCategoryType: {
          useMutation: (opts: { onSuccess?: (value: Category) => void }) => ({
            isPending: false,
            mutate: ({ name }: { name: string }) => {
              const created = { id: `category-${name.toLowerCase()}`, name };
              opts.onSuccess?.(created);
            },
          }),
        },
        createMaterial: {
          useMutation: (opts: { onSuccess?: (value: Material) => void }) => ({
            isPending: false,
            mutate: ({ name }: { name: string }) => {
              const created = { id: `material-${name.toLowerCase()}`, name };
              opts.onSuccess?.(created);
            },
          }),
        },
        createSize: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        createPart: {
          useMutation: (opts: { onSuccess?: (part: any) => Promise<void>; onError?: (error: Error) => void }) => ({
            isPending: false,
            mutateAsync: async (input: unknown) => {
              try {
                const result = await editState.create(input);
                await opts.onSuccess?.(result);
                return result;
              } catch (error) { opts.onError?.(error as Error); throw error; }
            },
          }),
        },
        updatePart: {
          useMutation: (opts: { onError?: (error: Error) => void }) => ({ isPending: false, mutate: vi.fn(), mutateAsync: async (input: unknown) => { try { return await editState.save(input); } catch (error) { opts.onError?.(error as Error); throw error; } } }),
        },
      },
      supplier: {
        list: { useQuery: () => makeResult([]) },
        getById: { useQuery: () => ({ data: undefined, isLoading: false }) },
        getSupplierPartsByPart: { useQuery: () => makeResult([]) },
      },
    },
  };
});

describe("PartDetailsDialog inline add", () => {
  beforeEach(() => {
    familyState.data = undefined;
    familyState.lastInput = undefined;
    editState.part = undefined;
    editState.save.mockReset();
    globalThis.__partDialogMockData = {
      catalogs: [{ id: "catalog-existing", name: "Existing Catalog" }],
      materials: [],
      categories: [],
      units: [
        { id: "u-in", code: "in", displayName: "Inches", kind: "length" },
      ],
    };
  });

  it("shows the shared photo controls while creating a part", () => {
    render(
      <PartDetailsDialog
        mode="create"
        open
        onOpenChange={() => {}}
        initialContext={{}}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Search For Image/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get Image \/ Share Image/i }),
    ).toBeInTheDocument();
  });

  it("gets an image from similar parts when the part has none", async () => {
    familyState.data = {
      familyLabel: "Elbow",
      suggestions: [
        { id: "a", displayName: '1/2" Copper Elbow', description: null, imageUrl: "/images/catalog/uploads/elbow.webp", material: "Copper", size: '1/2"' },
        { id: "b", displayName: '3/4" Copper Elbow', description: null, imageUrl: "/images/catalog/uploads/elbow.webp", material: "Copper", size: '3/4"' },
        { id: "c", displayName: '1" Copper Elbow', description: null, imageUrl: "/images/catalog/uploads/elbow-2.webp", material: "Copper", size: '1"' },
      ],
    };
    render(
      <PartDetailsDialog
        mode="create"
        open
        onOpenChange={() => {}}
        initialContext={{}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g., 90° Copper Elbow"), {
      target: { value: '1-1/4" Copper Elbow' },
    });
    fireEvent.click(screen.getByRole("button", { name: /Get Image \/ Share Image/i }));

    expect(familyState.lastInput?.mode).toBe("get");
    expect(await screen.findByText("Get Image From Similar Parts")).toBeInTheDocument();
    // Two distinct images; the one used by two parts is listed first.
    expect(screen.getByText("Used by 2 similar parts")).toBeInTheDocument();
    expect(screen.getByText("Used by 1 similar part")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Use Image/i })[0]!);
    await waitFor(() =>
      expect(screen.queryByText("Get Image From Similar Parts")).not.toBeInTheDocument(),
    );
    expect(
      document.querySelector('img[src="/images/catalog/uploads/elbow.webp"]'),
    ).not.toBeNull();
  });

  it("rejects invalid size input and flashes an invalid marker", async () => {
    render(
      <PartDetailsDialog
        mode="create"
        open
        onOpenChange={() => {}}
        initialContext={{}}
      />,
    );

    const sizeInput = screen.getAllByPlaceholderText(
      "1/2, 1.5, 3 x 3 x 3, or 3x2x2",
    )[0]!;

    fireEvent.change(sizeInput, { target: { value: "3a" } });

    expect(sizeInput).toHaveValue("");
    expect(
      await screen.findByLabelText("Invalid size input"),
    ).toBeInTheDocument();

    fireEvent.change(sizeInput, { target: { value: "3 x 2.5" } });

    expect(sizeInput).toHaveValue("3 x 2.5");

    fireEvent.change(sizeInput, { target: { value: "1/" } });

    expect(sizeInput).toHaveValue("1/");

    fireEvent.change(sizeInput, { target: { value: "1 1/" } });

    expect(sizeInput).toHaveValue("1 1/");

    fireEvent.change(sizeInput, { target: { value: "1 1/2 x 3/4" } });

    expect(sizeInput).toHaveValue("1 1/2 x 3/4");
  });

  it("returns to dropdown mode and selects a newly added catalog", async () => {
    render(
      <PartDetailsDialog
        mode="create"
        open
        onOpenChange={() => {}}
        initialContext={{}}
      />,
    );

    fireEvent.click(screen.getAllByText("+ Add")[2]!);
    fireEvent.change(screen.getByPlaceholderText("New catalog name"), {
      target: { value: "Plumbing" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!);

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("New catalog name"),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: /Plumbing/i }).length,
      ).toBeGreaterThan(0);
    });
  });

  it("returns to dropdown mode and selects an existing catalog when re-added", async () => {
    globalThis.__partDialogMockData.catalogs = [
      { id: "catalog-plumbing", name: "Plumbing" },
    ];

    render(
      <PartDetailsDialog
        mode="create"
        open
        onOpenChange={() => {}}
        initialContext={{}}
      />,
    );

    fireEvent.click(screen.getAllByText("+ Add")[2]!);
    fireEvent.change(screen.getByPlaceholderText("New catalog name"), {
      target: { value: "Plumbing" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!);

    expect(
      screen.queryByPlaceholderText("New catalog name"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Plumbing/i }).length,
    ).toBeGreaterThan(0);
  });
});

describe("editing a part name", () => {
  beforeEach(() => {
    editState.save.mockReset();
    globalThis.__partDialogMockData = { catalogs:[{id:"catalog-existing",name:"Plumbing"}], materials:[], categories:[], units:[{id:"u-in",code:"in",displayName:"Inches",kind:"length"}] };
    editState.part = { id:"part-existing", displayName:'8" Old name', materialId:"material-xfr", material:"XFR", catalogId:"catalog-existing", categoryId:"category-fitting", sizeNominal:8, sizeLabel:"8", sizeUnitId:"u-in", isActive:true, aliases:[] };
  });
  it("retains material even before materials load and closes only after save", async () => {
    let finish!: () => void;
    editState.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const close = vi.fn();
    render(<PartDetailsDialog mode="edit" open partId="part-existing" onOpenChange={close} />);
    fireEvent.change(screen.getByDisplayValue('8" Old name'),{target:{value:'8" fitting 45'}});
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    await waitFor(()=>expect(editState.save).toHaveBeenCalledWith(expect.objectContaining({displayName:'8" fitting 45',materialId:'material-xfr',categoryId:'category-fitting',sizeNominal:8,isActive:true})));
    expect(close).not.toHaveBeenCalled();
    finish();
    await waitFor(()=>expect(close).toHaveBeenCalledWith(false));
  });
  it("adds a custom unit from Where it goes and selects it", async () => {
    render(<PartDetailsDialog mode="edit" open partId="part-existing" onOpenChange={() => {}} />);
    const section = screen.getByText("Where it goes").closest("section")!;
    expect(section.contains(screen.getByLabelText("Bulk unit"))).toBe(true);
    expect(section.contains(screen.getByLabelText("Individual units per bulk unit"))).toBe(true);
    fireEvent.click(screen.getAllByText("+ Add")[0]!);
    fireEvent.change(screen.getByLabelText("New bulk unit"), {target:{value:"carton"}});
    fireEvent.click(screen.getByRole("button", {name:"Add"}));
    await waitFor(() => expect(screen.getByLabelText("Bulk unit")).toHaveValue("carton"));
  });
  it("loads and saves separate bulk and individual units", async () => {
    Object.assign(editState.part!, {bulkUnit: "box", individualUnit: "pcs", piecesPerPack: 50});
    editState.save.mockResolvedValue(undefined);
    render(<PartDetailsDialog mode="edit" open partId="part-existing" onOpenChange={() => {}} />);
    expect(screen.getByLabelText("Bulk unit")).toHaveValue("box");
    expect(screen.getByLabelText("Individual unit")).toHaveValue("pcs");
    fireEvent.change(screen.getByLabelText("Bulk unit"), {target:{value:"roll"}});
    fireEvent.change(screen.getByLabelText("Individual unit"), {target:{value:"ft"}});
    fireEvent.click(screen.getByRole("button", {name:"Save"}));
    await waitFor(() => expect(editState.save).toHaveBeenCalledWith(expect.objectContaining({bulkUnit:"roll", individualUnit:"ft", piecesPerPack:50, description:"(50 ft per roll)"})));
  });
  it("keeps the editor open and displays a save failure", async () => {
    editState.save.mockRejectedValue(new Error('Save failed'));
    const close = vi.fn();
    render(<PartDetailsDialog mode="edit" open partId="part-existing" onOpenChange={close} />);
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    await waitFor(()=>expect(screen.getByText('Save failed')).toBeTruthy());
    expect(close).not.toHaveBeenCalled();
  });
});


describe("creating a part from a material list", () => {
  beforeEach(() => {
    editState.part = undefined;
    editState.create.mockReset();
    globalThis.__partDialogMockData = { catalogs:[{id:"catalog-existing",name:"Plumbing"}], materials:[], categories:[], units:[{id:"u-in",code:"in",displayName:"Inches",kind:"length"}] };
  });
  it("waits for creation and the pending-list handoff before closing", async () => {
    let finish!: (part: unknown) => void;
    editState.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const close = vi.fn();
    const created = vi.fn();
    render(<PartDetailsDialog mode="create" open initialContext={{catalogId:"catalog-existing"}} onOpenChange={close} onPartCreated={created} />);
    fireEvent.change(screen.getByPlaceholderText("e.g., 90° Copper Elbow"), {target:{value:"Test valve"}});
    fireEvent.click(screen.getByRole("button",{name:"Create"}));
    await waitFor(() => expect(editState.create).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
    finish({id:"new-valve",displayName:"Test valve",imageUrl:null,material:null,sizeLabel:null,sizeUnit:null,piecesPerPack:50,bulkUnit:"box",individualUnit:"pcs"});
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(created).toHaveBeenCalledWith(expect.objectContaining({id:"new-valve",piecesPerPack:50,bulkUnit:"box",individualUnit:"pcs"}));
    expect(created.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]!);
  });
  it("keeps the entered part and error visible when creation fails", async () => {
    editState.create.mockRejectedValue(new Error("Could not save valve"));
    const close = vi.fn();
    render(<PartDetailsDialog mode="create" open initialContext={{catalogId:"catalog-existing"}} onOpenChange={close} />);
    fireEvent.change(screen.getByPlaceholderText("e.g., 90° Copper Elbow"), {target:{value:"Test valve"}});
    fireEvent.click(screen.getByRole("button",{name:"Create"}));
    expect(await screen.findByText("Could not save valve")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test valve")).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
