"use client";

import { useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { useClientPagination } from "~/components/ui/list-pagination";
import {
  materialGroupEntries,
  materialPath,
  type GroupedMaterial,
} from "~/lib/material-groups";
import {
  PartCount,
  WizardAllOption,
  WIZARD_OPTION_GRID_CLASS,
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
              <ChevronRight className="h-4 w-4 text-gray-400" />
              <button
                type="button"
                aria-current={
                  index === path.length - 1 ? "location" : undefined
                }
                className="min-h-10 rounded px-2 hover:bg-gray-100"
                onClick={() => browse(path.slice(0, index + 1))}
              >
                {name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div className={WIZARD_OPTION_GRID_CLASS}>
        {path.length === 0 && (
          <WizardAllOption
            selected={allSelected}
            onSelect={() => onMaterialSelect(null)}
          />
        )}
        {pagination.paginatedItems.map((entry) => (
          <button
            type="button"
            key={entry.key}
            className={`w-full max-w-[4in] cursor-pointer rounded-xl border bg-white p-2 text-center shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 sm:p-4 ${entry.kind === "material" && selectedMaterialId === entry.material.id ? "border-primary border-2" : ""}`}
            onClick={() =>
              entry.kind === "group"
                ? browse(entry.path)
                : onMaterialSelect(entry.material.id)
            }
          >
            {entry.kind === "group" && (
              <Folder
                className="mx-auto mb-1 h-5 w-5 text-blue-600"
                aria-hidden="true"
              />
            )}
            <p className="text-sm font-medium sm:text-base">{entry.name}</p>
            {entry.kind === "group" ? (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  {entry.materialCount} material types
                </p>
                <PartCount count={entry.count} />
              </>
            ) : (
              <PartCount count={entry.material.count} />
            )}
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
