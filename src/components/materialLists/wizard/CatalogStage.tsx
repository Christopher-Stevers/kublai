"use client";

import { useClientPagination } from "~/components/ui/list-pagination";
import {
  PartCount,
  WizardAllOption,
  WizardOptionCard,
  WIZARD_OPTION_GRID_CLASS,
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
}: CatalogStageProps) {
  const pagination = useClientPagination(catalogs);
  void showCustomCatalogInput;
  void onShowCustomCatalogInput;
  void customCatalogName;
  void onCustomCatalogNameChange;
  void onCreateCatalog;
  void isOnline;

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Catalog</h3>
      <div className={WIZARD_OPTION_GRID_CLASS}>
        <WizardAllOption selected={allSelected} onSelect={() => onCatalogSelect(null)} />
        {pagination.paginatedItems.map((catalog) => (
          <WizardOptionCard
            key={catalog.id}
            selected={selectedCatalogId === catalog.id}
            onClick={() => onCatalogSelect(catalog.id)}
          >
            <p className="text-sm font-medium sm:text-base">{catalog.name}</p>
            <PartCount count={catalog.count} />
          </WizardOptionCard>
        ))}
      </div>
      <WizardOptionPagination pagination={pagination} itemLabel="catalogs" />
    </div>
  );
}
