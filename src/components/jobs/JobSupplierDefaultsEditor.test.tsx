import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { JobSupplierDefaults } from "~/lib/job-supplier-defaults";
import { JobSupplierDefaultsEditor } from "./JobSupplierDefaultsEditor";
const { base, alma } = vi.hoisted(() => ({
  base: { supplierId: "supplier", bookId: null, label: "Next" },
  alma: { supplierId: "supplier", bookId: "alma", label: "Next (Alma)" },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    job: {
      supplierDefaultOptions: {
        useQuery: () => ({
          data: { defaults: null, options: [base, alma] },
          isError: false,
        }),
      },
    },
  },
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/hooks/use-replicache-catalogue", () => ({
  useReplicacheCatalogue: () => ({
    catalogs: [{ id: "plumbing", name: "Plumbing" }],
    materials: [{ id: "copper", name: "Copper" }],
    categories: [],
    parts: [],
  }),
}));
afterEach(cleanup);
function Editor() {
  const [value, onChange] = useState<JobSupplierDefaults>({
    rules: [
      {
        id: "first",
        catalogId: "plumbing",
        materialId: null,
        categoryId: null,
        size: null,
        supplier: base,
      },
      {
        id: "second",
        catalogId: null,
        materialId: "copper",
        categoryId: null,
        size: null,
        supplier: alma,
      },
    ],
    fallback: base,
  });
  return (
    <>
      <JobSupplierDefaultsEditor
        jobId="job"
        value={value}
        onChange={onChange}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}
it("reorders overlapping rules while keeping fallback pinned and combines supplier versions", () => {
  render(<Editor />);
  expect(screen.getByLabelText("Supplier for rule 1")).toHaveValue(
    "supplier:base",
  );
  expect(screen.getByLabelText("Supplier for rule 2")).toHaveValue(
    "supplier:alma",
  );
  fireEvent.click(screen.getByRole("button", { name: "Move rule 2 up" }));
  expect(screen.getByLabelText("Supplier for rule 1")).toHaveValue(
    "supplier:alma",
  );
  expect(screen.getByLabelText("Material for rule 1")).toHaveValue("copper");
  expect(screen.getByLabelText("Fallback supplier")).toHaveValue(
    "supplier:base",
  );
  expect(screen.getByRole("button", { name: "Clear fallback" })).toBeDisabled();
  expect(screen.queryByLabelText(/pricing list/i)).toBeNull();
});
it("edits combined filters and clears fallback only after removing the rules", () => {
  render(<Editor />);
  fireEvent.change(screen.getByLabelText("Material for rule 1"), {
    target: { value: "copper" },
  });
  expect(screen.getByLabelText("Catalog for rule 1")).toHaveValue("plumbing");
  expect(screen.getByLabelText("Material for rule 1")).toHaveValue("copper");
  fireEvent.change(screen.getByLabelText("Supplier for rule 1"), {
    target: { value: "supplier:alma" },
  });
  expect(screen.getByTestId("value").textContent).toContain('"bookId":"alma"');
  fireEvent.click(screen.getByRole("button", { name: "Remove rule 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear fallback" }));
  expect(screen.getByLabelText("Fallback supplier")).toHaveValue("");
});
