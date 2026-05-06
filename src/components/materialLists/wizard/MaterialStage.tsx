"use client";

import { useClientPagination } from "~/components/ui/list-pagination";
import {
  CustomOptionForm,
  PartCount,
  WizardAllOption,
  WizardOptionCard,
  WIZARD_OPTION_GRID_CLASS,
  WizardOptionPagination,
} from "./WizardOptionGrid";

export interface MaterialStageProps {
  materials: Array<{ id: string; name: string; count?: number }>;
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
}

export function MaterialStage({
  materials,
  selectedMaterialId,
  allSelected = false,
  onMaterialSelect,
  showCustomMaterialInput,
  customMaterialName,
  onCustomMaterialNameChange,
  onCreateMaterial,
}: MaterialStageProps) {
  const pagination = useClientPagination(materials);
  const submitCustomMaterial = () => {
    if (customMaterialName.trim()) {
      onCreateMaterial.mutate({ name: customMaterialName.trim() });
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Material</h3>
      <div className={WIZARD_OPTION_GRID_CLASS}>
        <WizardAllOption selected={allSelected} onSelect={() => onMaterialSelect(null)} />
        {pagination.paginatedItems.map((material) => (
          <WizardOptionCard
            key={material.id}
            selected={selectedMaterialId === material.id}
            onClick={() => onMaterialSelect(material.id)}
          >
            <p className="text-sm font-medium sm:text-base">{material.name}</p>
            <PartCount count={material.count} />
          </WizardOptionCard>
        ))}
      </div>
      {showCustomMaterialInput && (
        <CustomOptionForm
          value={customMaterialName}
          placeholder="Enter custom material name"
          buttonLabel="Add Material"
          isPending={onCreateMaterial.isPending}
          onChange={onCustomMaterialNameChange}
          onSubmit={submitCustomMaterial}
        />
      )}
      <WizardOptionPagination pagination={pagination} itemLabel="materials" />
    </div>
  );
}
