import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PartDetailsDialog } from "./PartDetailsDialog";

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
        },
        supplier: {
          getSupplierPartsByPart: { fetch: vi.fn().mockResolvedValue([]) },
        },
      }),
      catalogue: {
        getPart: { useQuery: () => ({ data: undefined, isLoading: false }) },
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
          useQuery: () => ({
            data: undefined,
            isLoading: false,
            isFetching: false,
          }),
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
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        updatePart: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
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
      screen.getByRole("button", { name: /Share Image With Similar Parts/i }),
    ).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByText("+ Add")[0]!);
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

    fireEvent.click(screen.getAllByText("+ Add")[0]!);
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
