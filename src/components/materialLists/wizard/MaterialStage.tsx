"use client";
import { isInMaterialGroup } from "~/lib/material-groups";

import { useArcScrollerOptions } from "~/components/ui/arc-scroller";
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
  WizardOptionCard,
  WIZARD_OPTION_GRID_CLASS,
  wizardOptionGridStyle,
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
  useArcScrollerOptions("Select Material", [
    { label: "All", select: () => onMaterialSelect(null) },
    ...materials.map(material => ({ label: material.name, select: () => onMaterialSelect(material.id) })),
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
            className="min-h-10 rounded px-2 text-primary hover:bg-primary/5"
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
            onSelect={() => onMaterialSelect(null)}
          />
        )}
        {pagination.paginatedItems.map((entry) => (
          <WizardOptionCard
            key={entry.key}
            hideCriteria={entry.kind === "material" ? {materialId: entry.material.id} : materials.filter(m => isInMaterialGroup(materialPath(m),entry.path)).map(m => ({materialId:m.id}))}
            tutorialChoice={entry.name}
            selected={entry.kind === "material" && selectedMaterialId === entry.material.id}
            onClick={() => entry.kind === "group" ? browse(entry.path) : onMaterialSelect(entry.material.id)}
          >
            <p className={WIZARD_OPTION_LABEL_CLASS}>{entry.name}</p>
          </WizardOptionCard>
        ))}
      </div>
      <WizardOptionPagination
        pagination={pagination}
        itemLabel={path.length ? "material types" : "materials and groups"}
      />
    </div>
  );
}
