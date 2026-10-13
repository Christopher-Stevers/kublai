"use client";

import { useQuickWheelOptions } from "./QuickWheel";
import { useClientPagination } from "~/components/ui/list-pagination";
import {
  WIZARD_OPTION_LABEL_CLASS,
  WizardAllOption,
  WizardOptionCard,
  WIZARD_OPTION_GRID_CLASS,
  wizardOptionGridStyle,
  WizardOptionPagination,
} from "./WizardOptionGrid";

export interface CatalogStageProps {
  catalogs: Array<{ id: string; name: string; count?: number }>;
  selectedCatalogId: string | null;
  allSelected?: boolean;
  onCatalogSelect: (catalogId: string | null) => void;
  showCustomCatalogInput: boolean;
  onShowCustomCatalogInput: (show: boolean) => void;
  customCatalogName: string;
  onCustomCatalogNameChange: (name: string) => void;
  onCreateCatalog: {
    mutate: (variables: { name: string }) => void;
    isPending: boolean;
  };
  isOnline?: boolean;
  /** Shows a Prefabs card next to All (material lists only). */
  onPrefabsSelect?: () => void;
}

export function CatalogStage({
  catalogs,
  selectedCatalogId,
  allSelected = false,
  onCatalogSelect,
  showCustomCatalogInput,
  onShowCustomCatalogInput,
  customCatalogName,
  onCustomCatalogNameChange,
  onCreateCatalog,
  isOnline = true,
  onPrefabsSelect,
}: CatalogStageProps) {
  const pagination = useClientPagination(catalogs);
  const choose = useQuickWheelOptions("Select Catalog", [
    { label: "All", select: () => onCatalogSelect(null) },
    ...(onPrefabsSelect ? [{ label: "Prefabs", select: onPrefabsSelect }] : []),
    ...catalogs.map(catalog => ({ label: catalog.name, select: () => onCatalogSelect(catalog.id) })),
  ]);
  void showCustomCatalogInput;
  void onShowCustomCatalogInput;
  void customCatalogName;
  void onCustomCatalogNameChange;
  void onCreateCatalog;
  void isOnline;

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Catalog</h3>
      <div
        className={WIZARD_OPTION_GRID_CLASS}
        style={wizardOptionGridStyle(
          1 + (onPrefabsSelect ? 1 : 0) + pagination.paginatedItems.length,
        )}
      >
        <WizardAllOption selected={allSelected} onSelect={() => choose("All")} />
        {onPrefabsSelect && (
          <WizardOptionCard tutorialChoice="Prefabs" onClick={() => choose("Prefabs")}>
            <p className={WIZARD_OPTION_LABEL_CLASS}>Prefabs</p>
          </WizardOptionCard>
        )}
        {pagination.paginatedItems.map((catalog) => (
          <WizardOptionCard
            key={catalog.id}
            tutorialChoice={catalog.name}
            selected={selectedCatalogId === catalog.id}
            onClick={() => choose(catalog.name)}
          >
            <p className={WIZARD_OPTION_LABEL_CLASS}>{catalog.name}</p>
          </WizardOptionCard>
        ))}
      </div>
      <WizardOptionPagination pagination={pagination} itemLabel="catalogs" />
    </div>
  );
}
