"use client";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { ListPagination, useClientPagination } from "~/components/ui/list-pagination";

export interface CatalogStageProps {
  catalogs: Array<{ id: string; name: string; count?: number }>;
  selectedCatalogId: string | null;
  onCatalogSelect: (catalogId: string) => void;
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
  onCatalogSelect,
  showCustomCatalogInput,
  onShowCustomCatalogInput,
  customCatalogName,
  onCustomCatalogNameChange,
  onCreateCatalog,
}: CatalogStageProps) {
  const pagination = useClientPagination(catalogs);

  return (
    <div className="space-y-3 sm:space-y-4">
      <h3 className="text-base font-semibold sm:text-lg">Select Catalog</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
        {pagination.paginatedItems.map((catalog) => (
          <Card
            key={catalog.id}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedCatalogId === catalog.id
                ? "border-primary border-2 shadow-md"
                : ""
            }`}
            onClick={() => onCatalogSelect(catalog.id)}
          >
            <CardContent className="p-3 text-center sm:p-4">
              <p className="text-sm font-medium sm:text-base">{catalog.name}</p>
              {catalog.count !== undefined && catalog.count > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  {catalog.count} part{catalog.count !== 1 ? "s" : ""}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
        <Card
          className={`cursor-pointer border-dashed transition-all hover:shadow-md ${
            showCustomCatalogInput ? "border-primary border-2" : ""
          }`}
          onClick={() => onShowCustomCatalogInput(true)}
        >
          <CardContent className="p-3 text-center sm:p-4">
            <p className="text-sm font-medium sm:text-base">Other</p>
          </CardContent>
        </Card>
      </div>
      {showCustomCatalogInput && (
        <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
          <Input
            placeholder="Enter catalog name"
            value={customCatalogName}
            onChange={(e) => onCustomCatalogNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customCatalogName.trim()) {
                onCreateCatalog.mutate({
                  name: customCatalogName.trim(),
                });
              }
            }}
            className="flex-1 text-sm sm:text-base"
            autoFocus
            disabled={onCreateCatalog.isPending}
          />
          <Button
            onClick={() => {
              if (customCatalogName.trim()) {
                onCreateCatalog.mutate({
                  name: customCatalogName.trim(),
                });
              }
            }}
            disabled={!customCatalogName.trim() || onCreateCatalog.isPending}
            className="w-full text-xs sm:w-auto sm:text-sm"
          >
            {onCreateCatalog.isPending ? "Adding..." : "Add Catalog"}
          </Button>
        </div>
      )}
      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        startItem={pagination.startItem}
        endItem={pagination.endItem}
        itemLabel="catalogs"
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
