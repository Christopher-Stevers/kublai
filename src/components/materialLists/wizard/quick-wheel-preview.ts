import { formatSizeDimensions } from "~/lib/size-utils";
import { wizardExactSizeLabel } from "~/lib/wizard-size-selection";
import type { WizardStage } from "./types";
import type { ReactNode } from "react";

export type WheelPreview = {
  title: string;
  kind: "wheel" | "parts";
  options: Array<{ label: string; imageUrl?: string | null; icon?: ReactNode; disabled?: boolean }>;
};
export type PreviewSelection = {
  catalogId: string | null;
  materialId: string | null;
  size: { nominal: number; unit: string; sizeLabel?: string | null } | null;
  categoryId: string | null;
};
export type PreviewFacet = {
  catalogId: string;
  materialId: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  sizeLabel?: string | null;
  categoryId: string | null;
};
export function matchesPreviewSelection(
  part: PreviewFacet,
  selection: PreviewSelection,
) {
  return (
    (!selection.catalogId || part.catalogId === selection.catalogId) &&
    (!selection.materialId || part.materialId === selection.materialId) &&
    (!selection.categoryId || part.categoryId === selection.categoryId) &&
    (!selection.size ||
      (Number(part.sizeNominal) === selection.size.nominal &&
        part.sizeUnit === selection.size.unit &&
        (!wizardExactSizeLabel(selection.size.sizeLabel) ||
          part.sizeLabel === selection.size.sizeLabel)))
  );
}

type Metadata = {
  catalogs: Array<{ id: string; name: string }>;
  materials: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  parts: PreviewFacet[];
};
/** Pure look-ahead: never run selection callbacks, create records or alter the wizard. */
export function nextWheelPreview(
  stage: WizardStage,
  label: string,
  current: PreviewSelection,
  data: Metadata,
): { selection: PreviewSelection; preview: WheelPreview } | undefined {
  const selection = { ...current };
  const sizesFor = (parts: PreviewFacet[]) => {
    const values = new Map<
      string,
      { label: string; size: NonNullable<PreviewSelection["size"]> }
    >();
    for (const part of parts) {
      if (part.sizeNominal === null || !part.sizeUnit) continue;
      const size = {
        nominal: Number(part.sizeNominal),
        unit: part.sizeUnit,
        sizeLabel: part.sizeLabel ?? null,
      };
      const label = formatSizeDimensions(
        part.sizeLabel ?? size.nominal,
        size.unit,
      );
      values.set(label, { label, size });
    }
    return [...values.values()].sort(
      (a, b) =>
        a.size.nominal - b.size.nominal ||
        a.size.unit.localeCompare(b.size.unit) ||
        (a.size.sizeLabel ?? "").localeCompare(
          b.size.sizeLabel ?? "",
          undefined,
          { numeric: true },
        ),
    );
  };
  const all = label === "All";
  let next: "material" | "size" | "category" | "part";
  if (stage === "catalog") {
    const option = data.catalogs.find((item) => item.name === label);
    if (!all && !option) return;
    selection.catalogId = all ? null : option!.id;
    selection.materialId = null;
    selection.size = null;
    selection.categoryId = null;
    next = "material";
  } else if (stage === "material") {
    const option = data.materials.find((item) => item.name === label);
    if (!all && !option) return;
    selection.materialId = all ? null : option!.id;
    selection.size = null;
    selection.categoryId = null;
    next = "size";
  } else if (stage === "size") {
    const option = sizesFor(
      data.parts.filter((part) =>
        matchesPreviewSelection(part, {
          ...selection,
          size: null,
          categoryId: null,
        }),
      ),
    ).find((item) => item.label === label);
    if (!all && !option) return;
    selection.size = all ? null : option!.size;
    selection.categoryId = null;
    next = "category";
  } else if (stage === "category") {
    const option = data.categories.find((item) => item.name === label);
    if (!all && !option) return;
    selection.categoryId = all ? null : option!.id;
    next = "part";
  } else return;
  const parts = data.parts.filter((part) =>
    matchesPreviewSelection(part, selection),
  );
  // Match the wizard's forward skips for steps with no available choices.
  if (next === "material") {
    const ids = new Set(parts.map((part) => part.materialId));
    const options = data.materials.filter((item) => ids.has(item.id));
    if (options.length)
      return {
        selection,
        preview: {
          title: "Select Material",
          kind: "wheel",
          options: [
            { label: "All" },
            ...options.map((item) => ({ label: item.name })),
          ],
        },
      };
    next = "size";
  }
  if (next === "size") {
    const options = sizesFor(parts);
    if (options.length)
      return {
        selection,
        preview: {
          title: "Select Size",
          kind: "wheel",
          options: [
            { label: "All" },
            ...options.map((item) => ({ label: item.label })),
          ],
        },
      };
    next = "category";
  }
  if (next === "category") {
    const ids = new Set(parts.map((part) => part.categoryId));
    const options = data.categories.filter((item) => ids.has(item.id));
    if (options.length)
      return {
        selection,
        preview: {
          title: "Select Category",
          kind: "wheel",
          options: [
            { label: "All" },
            ...options.map((item) => ({ label: item.name })),
          ],
        },
      };
  }
  return { selection, preview: { title: "Parts", kind: "parts", options: [] } };
}
