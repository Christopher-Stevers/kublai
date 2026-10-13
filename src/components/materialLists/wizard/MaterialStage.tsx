"use client";

import { useQuickWheelOptions } from "./QuickWheel";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useClientPagination } from "~/components/ui/list-pagination";
import {
  materialGroupEntries,
  materialPath,
  type GroupedMaterial,
} from "~/lib/material-groups";
import {
  WIZARD_OPTION_LABEL_CLASS,
  WizardAllOption,
  WIZARD_OPTION_GRID_CLASS,
  wizardOptionGridStyle,
  WIZARD_OPTION_ITEM_SIZE_CLASS,
  WizardOptionPagination,
} from "./WizardOptionGrid";

export interface MaterialStageProps {
  materials: GroupedMaterial[];
  selectedMaterialId: string | null;
  allSelected?: boolean;
  onMaterialSelect: (materialId: string | null) => void;
  showCustomMaterialInput: boolean;
  onShowCustomMaterialInput: (show: boolean) => void;
  customMaterialName: string;
  onCustomMaterialNameChange: (name: string) => void;
  onCreateMaterial: {
    mutate: (variables: { name: string }) => void;
    isPending: boolean;
  };
  isOnline?: boolean;
}

export function MaterialStage({
  materials,
  selectedMaterialId,
  allSelected = false,
  onMaterialSelect,
}: MaterialStageProps) {
  // Returning from sizes opens the group containing the previously chosen material.
  const [browsingPath, setBrowsingPath] = useState<string[] | null>(null);
  const selected = materials.find(
    (material) => material.id === selectedMaterialId,
  );
  const preferredPath =
    browsingPath ?? (selected ? materialPath(selected) : []);
  const path =
    preferredPath.length &&
    !materialGroupEntries(materials, preferredPath).length
      ? []
      : preferredPath;
  const entries = materialGroupEntries(materials, path);
  const pagination = useClientPagination(entries);
  function browse(next: string[]) {
    setBrowsingPath(next);
    pagination.setPage(1);
  }
  const choose = useQuickWheelOptions(path.length ? `Select ${path.at(-1)} type` : "Select Material", [
    ...(path.length ? [{ label: "Back", select: () => browse(path.slice(0, -1)) }] : [{ label: "All", select: () => onMaterialSelect(null) }]),
    ...entries.map(entry => ({ label: entry.name, select: () => entry.kind === "group" ? browse(entry.path) : onMaterialSelect(entry.material.id) })),
  ]);
  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">
        {path.length ? `Select ${path.at(-1)} type` : "Select Material"}
      </h3>
      {path.length > 0 && (
        <nav
          aria-label="Material groups"
          className="flex flex-wrap items-center gap-1 text-sm"
        >
          <button
            type="button"
            className="min-h-10 rounded px-2 text-blue-700 hover:bg-blue-50"
            onClick={() => browse([])}
          >
            All materials
          </button>
          {path.map((name, index) => (
            <span key={index} className="inline-flex items-center gap-1">
              <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
              <button
                type="button"
                aria-current={
                  index === path.length - 1 ? "location" : undefined
                }
                className="min-h-10 rounded px-2 hover:bg-accent"
                onClick={() => browse(path.slice(0, index + 1))}
              >
                {name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div
        className={WIZARD_OPTION_GRID_CLASS}
        style={wizardOptionGridStyle(
          (path.length === 0 ? 1 : 0) + pagination.paginatedItems.length,
        )}
      >
        {path.length === 0 && (
          <WizardAllOption
            selected={allSelected}
            onSelect={() => choose("All")}
          />
        )}
        {pagination.paginatedItems.map((entry) => (
          <button
            type="button"
            key={entry.key}
            data-tutorial-choice={entry.name}
            className={`flex ${WIZARD_OPTION_ITEM_SIZE_CLASS} cursor-pointer items-center justify-center rounded-xl border bg-card p-2 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.06)] transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 sm:p-4 ${entry.kind === "material" && selectedMaterialId === entry.material.id ? "border-primary border-2" : ""}`}
            onClick={() => choose(entry.name)}
          >
            <p className={WIZARD_OPTION_LABEL_CLASS}>{entry.name}</p>
          </button>
        ))}
      </div>
      <WizardOptionPagination
        pagination={pagination}
        itemLabel={path.length ? "material types" : "materials and groups"}
      />
    </div>
  );
}
