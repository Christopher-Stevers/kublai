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
}

export function CatalogStage({
  catalogs,
  selectedCatalogId,
  allSelected = false,
  onCatalogSelect,
  showCustomCatalogInput,
  customCatalogName,
  onCustomCatalogNameChange,
  onCreateCatalog,
}: CatalogStageProps) {
  const pagination = useClientPagination(catalogs);
  const submitCustomCatalog = () => {
    if (customCatalogName.trim()) {
      onCreateCatalog.mutate({ name: customCatalogName.trim() });
    }
  };

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
      {showCustomCatalogInput && (
        <CustomOptionForm
          value={customCatalogName}
          placeholder="Enter catalog name"
          buttonLabel="Add Catalog"
          isPending={onCreateCatalog.isPending}
          onChange={onCustomCatalogNameChange}
          onSubmit={submitCustomCatalog}
        />
      )}
      <WizardOptionPagination pagination={pagination} itemLabel="catalogs" />
    </div>
  );
}
