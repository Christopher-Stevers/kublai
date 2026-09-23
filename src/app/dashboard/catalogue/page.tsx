"use client";
import { EditPartDialog, CreateCustomPartDialog, MaterialGroupsDialog, PhotoQueueDialog } from "~/components/app/DeferredFeatures";

import { AssistanceLink } from "~/components/assist/AssistanceLink";

import { useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { CatalogStage } from "~/components/materialLists/wizard/CatalogStage";
import { MaterialStage } from "~/components/materialLists/wizard/MaterialStage";
import { SizeStage } from "~/components/materialLists/wizard/SizeStage";
import { CategoryStage } from "~/components/materialLists/wizard/CategoryStage";
import { PartStage } from "~/components/app/DeferredFeatures";
import { WizardHeader } from "~/components/materialLists/WizardHeader";
import { usePartWizard } from "~/components/materialLists/wizard/use-part-wizard";
import {
  downloadCatalogueRowsAsXlsx,
  readCatalogueImportWorkbook,
} from "~/lib/catalogue-xlsx";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER } from "~/lib/server-connection-mode";
import { Images } from "lucide-react";
import { confirmAction, notify } from "~/components/ui/app-dialogs";

export default function CataloguePage() {
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isCreatePartDialogOpen, setIsCreatePartDialogOpen] = useState(false);
  const [isPhotoQueueOpen, setIsPhotoQueueOpen] = useState(false);
  const [isMaterialGroupsOpen, setIsMaterialGroupsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportOptionsOpen, setIsExportOptionsOpen] = useState(false);
  const [exportCatalogId, setExportCatalogId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isBrowserOnline = useOnlineStatus();
  const isCatalogueOnline =
    isBrowserOnline && !TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER;
  const utils = api.useUtils();
  const { data: roleData } = api.user.getMyRole.useQuery();
  const canEditParts = roleData?.permissions.canEditParts ?? false;

  const importCatalogueRows = api.catalogue.importCatalogueRows.useMutation();

  const {
    wizardStage,
    selectedCatalogId,
    hasCatalogSelection,
    selectedMaterialId,
    hasMaterialSelection,
    selectedSize,
    hasSizeSelection,
    selectedCategory,
    hasCategorySelection,
    showCustomCatalogInput,
    setShowCustomCatalogInput,
    customCatalogName,
    setCustomCatalogName,
    showCustomMaterialInput,
    setShowCustomMaterialInput,
    customMaterialName,
    setCustomMaterialName,
    showCustomSize,
    setShowCustomSize,
    customSizeInput,
    setCustomSizeInput,
    customSizeUnitId,
    setCustomSizeUnitId,
    showCustomCategoryInput,
    setShowCustomCategoryInput,
    customCategoryName,
    setCustomCategoryName,
    wizardSearchQuery,
    setWizardSearchQuery,
    catalogs,
    catalogsWithCounts,
    materialsWithCounts,
    allUnits,
    categoriesWithCounts,
    filteredAvailableSizes,
    createCatalog,
    createMaterial,
    createSize,
    handleCatalogSelect,
    handleMaterialSelect,
    handleSizeSelect,
    handleCategorySelection,
    handleCustomCategorySubmit,
    handleStageClick,
    selectedCatalogName,
    selectedMaterialName,
    selectedSizeName,
    selectedCategoryName,
    filteredPartsForSelection,
    wizardSearchPlaceholder,
  } = usePartWizard();

  const catalogOptions = catalogs ?? [];
  const isWizardSearchActive =
    wizardStage !== "review" && wizardSearchQuery.trim().length > 0;
  const handleExportClick = () => {
    setExportCatalogId(null);
    setIsExportOptionsOpen(true);
  };

  const handleExport = async () => {
    const selectedCatalog = catalogOptions.find(
      (catalog) => catalog.id === exportCatalogId,
    );
    const filenameSuffix = selectedCatalog
      ? selectedCatalog.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "catalog"
      : "full-catalog";

    try {
      setIsExporting(true);
      const rows = await utils.catalogue.exportCatalogueRows.fetch({
        catalogId: exportCatalogId,
      });
      await downloadCatalogueRowsAsXlsx(
        rows,
        `foremenhq-${filenameSuffix}.xlsx`,
      );
      setIsExportOptionsOpen(false);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: { target: HTMLInputElement }) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setIsImporting(true);
      setImportProgress("Reading workbook...");
      const rows = await readCatalogueImportWorkbook(file);

      if (rows.length === 0) {
        notify("No usable catalogue rows were found in that workbook.", "error");
        return;
      }

      setImportProgress("Preparing local backup...");
      const existingRows = await utils.catalogue.exportCatalogueRows.fetch({
        catalogId: null,
      });
      const existingPartIds = new Set(
        existingRows
          .map((row) => String(row.partId ?? "").trim())
          .filter(Boolean),
      );
      const overwriteRows = rows.filter(
        (row) => row.partId && existingPartIds.has(row.partId),
      );

      if (overwriteRows.length > 0) {
        const sampleNames = overwriteRows
          .slice(0, 8)
          .map((row) => `• ${row.displayName}`)
          .join("\n");
        const moreCount = overwriteRows.length - 8;
        const shouldContinue = await confirmAction({
          title: `Overwrite ${overwriteRows.length} existing part${overwriteRows.length === 1 ? "" : "s"}?`,
          description: `These parts already exist (matched by partId) and will be replaced:\n\n${sampleNames}${moreCount > 0 ? `\n• ...and ${moreCount} more` : ""}\n\nA catalogue backup will download before the import starts.`,
          confirmLabel: "Back up and import",
          destructive: true,
        });

        if (!shouldContinue) {
          setImportProgress(null);
          return;
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await downloadCatalogueRowsAsXlsx(
        existingRows,
        `foremenhq-catalogue-backup-${timestamp}.xlsx`,
      );

      const batchSize = 50;
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        const batchNumber = Math.floor(start / batchSize) + 1;
        const batchCount = Math.ceil(rows.length / batchSize);
        setImportProgress(
          `Importing ${Math.min(start + batch.length, rows.length)} of ${rows.length} rows... (${batchNumber}/${batchCount})`,
        );

        const result = await importCatalogueRows.mutateAsync({ rows: batch });
        created += result.created;
        updated += result.updated;
        skipped += result.skipped;
      }

      setImportProgress("Refreshing catalogue...");
      await Promise.all([
        utils.catalogue.searchParts.invalidate(),
        utils.catalogue.getCatalogs.invalidate(),
        utils.catalogue.getCategoryTree.invalidate(),
        utils.catalogue.getMaterials.invalidate(),
      ]);

      notify(
        `Catalogue import done. Created ${created}, updated ${updated}, skipped ${skipped}.`,
        "success",
      );
    } catch (error) {
      console.error("Catalogue import failed", error);
      notify(
        "Catalogue import failed. Check the workbook format and try again.",
        "error",
      );
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  if (!isCatalogueOnline) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-muted/50 p-6">
        <div className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-foreground">
            Parts Catalogue is online-only
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Catalogue browsing, imports, exports, and edits require a server
            connection. Material-list field work can continue from local data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      <div className="border-b bg-card p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            Parts Catalogue
          </h1>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <AssistanceLink />
            {canEditParts && <Button variant="outline" disabled={!isCatalogueOnline} onClick={() => setIsMaterialGroupsOpen(true)}>Material groups</Button>}
            {canEditParts && (
              <Button
                variant="outline"
                onClick={() => setIsPhotoQueueOpen(true)}
              >
                <Images className="h-4 w-4" />
                Photos
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                onClick={handleImportClick}
                disabled={isImporting}
              >
                {isImporting ? "Importing..." : "Import XLSX"}
              </Button>
              {importProgress && (
                <div className="text-xs font-medium text-slate-600">
                  {importProgress}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              onClick={handleExportClick}
              disabled={isExporting}
            >
              {isExporting ? "Exporting..." : "Export XLSX"}
            </Button>
          </div>
        </div>
        <WizardHeader
          currentStage={wizardStage}
          selectedCatalog={selectedCatalogName}
          selectedMaterial={selectedMaterialName}
          selectedSize={selectedSizeName}
          selectedCategory={selectedCategoryName}
          onStageClick={handleStageClick}
          searchQuery={wizardSearchQuery}
          onSearchChange={setWizardSearchQuery}
          searchPlaceholder={wizardSearchPlaceholder}
          actionLabel="Create Part"
          onActionClick={() => setIsCreatePartDialogOpen(true)}
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/50 p-4 sm:p-6">
        {isWizardSearchActive ? (
          <PartStage
            partsForSelection={filteredPartsForSelection}
            pendingParts={[]}
            onPartSelect={(part) => setEditingPartId(part.id)}
            onPartQuantitySet={() => undefined}
            onQuantityPickerPreviewChange={() => undefined}
            onEditPart={setEditingPartId}




            actionMode="edit"
            title="Matching Parts"
            actionLabel="Edit"
          />
        ) : (
          wizardStage === "catalog" && (
            <CatalogStage
              catalogs={catalogsWithCounts}
              selectedCatalogId={selectedCatalogId}
              allSelected={hasCatalogSelection && selectedCatalogId === null}
              onCatalogSelect={handleCatalogSelect}
              showCustomCatalogInput={showCustomCatalogInput}
              onShowCustomCatalogInput={setShowCustomCatalogInput}
              customCatalogName={customCatalogName}
              onCustomCatalogNameChange={setCustomCatalogName}
              onCreateCatalog={createCatalog}
            />
          )
        )}

        {!isWizardSearchActive &&
          wizardStage === "material" &&
          hasCatalogSelection && (
            <MaterialStage
              materials={materialsWithCounts}
              selectedMaterialId={selectedMaterialId}
              allSelected={hasMaterialSelection && selectedMaterialId === null}
              onMaterialSelect={handleMaterialSelect}
              showCustomMaterialInput={showCustomMaterialInput}
              onShowCustomMaterialInput={setShowCustomMaterialInput}
              customMaterialName={customMaterialName}
              onCustomMaterialNameChange={setCustomMaterialName}
              onCreateMaterial={createMaterial}
            />
          )}

        {!isWizardSearchActive &&
          wizardStage === "size" &&
          hasCatalogSelection &&
          hasMaterialSelection && (
            <SizeStage
              availableSizes={filteredAvailableSizes}
              selectedSize={selectedSize}
              allSelected={hasSizeSelection && selectedSize === null}
              onSizeSelect={handleSizeSelect}
              showCustomSize={showCustomSize}
              onShowCustomSize={setShowCustomSize}
              customSizeInput={customSizeInput}
              onCustomSizeInputChange={setCustomSizeInput}
              customSizeUnitId={customSizeUnitId}
              onCustomSizeUnitIdChange={setCustomSizeUnitId}
              allUnits={(allUnits ?? []).map((u) => ({
                id: u.id,
                code: u.code,
              }))}
              onCreateSize={createSize}
            />
          )}

        {!isWizardSearchActive &&
          wizardStage === "category" &&
          hasCatalogSelection &&
          hasMaterialSelection &&
          hasSizeSelection && (
            <CategoryStage
              categories={categoriesWithCounts}
              selectedCategory={selectedCategory}
              allSelected={
                hasCategorySelection && selectedCategory?.categoryId === null
              }
              onCategorySelect={handleCategorySelection}
              showCustomCategoryInput={showCustomCategoryInput}
              onShowCustomCategoryInput={setShowCustomCategoryInput}
              customCategoryName={customCategoryName}
              onCustomCategoryNameChange={setCustomCategoryName}
              onCustomCategorySubmit={handleCustomCategorySubmit}
            />
          )}

        {!isWizardSearchActive &&
          wizardStage === "part" &&
          hasCatalogSelection &&
          hasMaterialSelection &&
          hasSizeSelection &&
          hasCategorySelection && (
            <PartStage
              partsForSelection={filteredPartsForSelection}
              pendingParts={[]}
              onPartSelect={(part) => setEditingPartId(part.id)}
              onPartQuantitySet={() => undefined}
              onQuantityPickerPreviewChange={() => undefined}
              onEditPart={setEditingPartId}




              actionMode="edit"
              title="Parts"
              actionLabel="Edit"
            />
          )}
      </div>

      <Dialog open={isExportOptionsOpen} onOpenChange={setIsExportOptionsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export Catalogue</DialogTitle>
            <DialogDescription>
              Choose which catalogue to include in the XLSX export.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setExportCatalogId(null)}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                exportCatalogId === null
                  ? "border-gray-900 bg-muted/50 text-foreground"
                  : "border-border bg-card text-foreground/80 hover:border-input"
              }`}
            >
              <span className="font-medium">Full Catalog</span>
              {exportCatalogId === null && (
                <span className="text-xs font-semibold">Selected</span>
              )}
            </button>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {catalogOptions.map((catalog) => (
                <button
                  key={catalog.id}
                  type="button"
                  onClick={() => setExportCatalogId(catalog.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                    exportCatalogId === catalog.id
                      ? "border-gray-900 bg-muted/50 text-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-input"
                  }`}
                >
                  <span className="font-medium">{catalog.name}</span>
                  {exportCatalogId === catalog.id && (
                    <span className="text-xs font-semibold">Selected</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsExportOptionsOpen(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleExport} disabled={isExporting}>
              {isExporting ? "Exporting..." : "Export XLSX"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditPartDialog
        open={editingPartId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPartId(null);
        }}
        partId={editingPartId}
      />
      <MaterialGroupsDialog open={isMaterialGroupsOpen} onOpenChange={setIsMaterialGroupsOpen} />
      <PhotoQueueDialog
        open={isPhotoQueueOpen}
        onOpenChange={setIsPhotoQueueOpen}
        catalogId={selectedCatalogId}
        materialId={selectedMaterialId}
        categoryId={selectedCategory?.categoryId}
      />
      <CreateCustomPartDialog
        open={isCreatePartDialogOpen}
        onOpenChange={setIsCreatePartDialogOpen}
        onPartCreated={() => {
          setIsCreatePartDialogOpen(false);
        }}
        initialContext={{
          catalogId: selectedCatalogId,
          materialId: selectedMaterialId,
          size: selectedSize,
          categoryId: selectedCategory?.categoryId ?? null,
          categoryName: selectedCategory?.name ?? null,
        }}
      />
    </div>
  );
}
