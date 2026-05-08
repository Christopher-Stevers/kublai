"use client";

import { useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import { CreateCustomPartDialog } from "~/components/materialLists/CreateCustomPartDialog";
import { CatalogStage } from "~/components/materialLists/wizard/CatalogStage";
import { MaterialStage } from "~/components/materialLists/wizard/MaterialStage";
import { SizeStage } from "~/components/materialLists/wizard/SizeStage";
import { CategoryStage } from "~/components/materialLists/wizard/CategoryStage";
import { PartStage } from "~/components/materialLists/wizard/PartStage";
import { WizardHeader } from "~/components/materialLists/WizardHeader";
import { usePartWizard } from "~/components/materialLists/wizard/use-part-wizard";
import {
  downloadCatalogueRowsAsXlsx,
  readCatalogueImportWorkbook,
} from "~/lib/catalogue-xlsx";

export default function CataloguePage() {
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isCreatePartDialogOpen, setIsCreatePartDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const utils = api.useUtils();

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
    setSelectedCategory,
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
    materials,
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

  const isWizardSearchActive =
    wizardStage !== "review" && wizardSearchQuery.trim().length > 0;

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const rows = await utils.catalogue.exportCatalogueRows.fetch();
      await downloadCatalogueRowsAsXlsx(rows, "foremenhq-catalogue.xlsx");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (
    event: { target: HTMLInputElement },
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setIsImporting(true);
      setImportProgress("Reading workbook...");
      const rows = await readCatalogueImportWorkbook(file);

      if (rows.length === 0) {
        alert("No usable catalogue rows were found in that workbook.");
        return;
      }

      setImportProgress("Preparing local backup...");
      const existingRows = await utils.catalogue.exportCatalogueRows.fetch();
      const existingPartIds = new Set(
        existingRows
          .map((row) => String(row.partId ?? "").trim())
          .filter(Boolean),
      );
      const overwriteRows = rows.filter((row) => row.partId && existingPartIds.has(row.partId));

      if (overwriteRows.length > 0) {
        const sampleNames = overwriteRows
          .slice(0, 8)
          .map((row) => `• ${row.displayName}`)
          .join("\n");
        const moreCount = overwriteRows.length - 8;
        const shouldContinue = window.confirm(
          `This import will overwrite ${overwriteRows.length} existing part${overwriteRows.length === 1 ? "" : "s"} because their partId already exists.\n\n${sampleNames}${moreCount > 0 ? `\n• ...and ${moreCount} more` : ""}\n\nA catalogue backup will download before import. Continue?`,
        );

        if (!shouldContinue) {
          setImportProgress(null);
          return;
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await downloadCatalogueRowsAsXlsx(existingRows, `foremenhq-catalogue-backup-${timestamp}.xlsx`);

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

      alert(`Catalogue import done. Created ${created}, updated ${updated}, skipped ${skipped}.`);
    } catch (error) {
      console.error("Catalogue import failed", error);
      alert("Catalogue import failed. Check the workbook format and try again.");
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      <div className="border-b bg-white p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Parts Catalogue</h1>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
            <div className="flex flex-col items-end gap-1">
              <Button variant="outline" onClick={handleImportClick} disabled={isImporting}>
                {isImporting ? "Importing..." : "Import XLSX"}
              </Button>
              {importProgress && <div className="text-xs font-medium text-slate-600">{importProgress}</div>}
            </div>
            <Button variant="outline" onClick={handleExport} disabled={isExporting}>
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

      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">
        {isWizardSearchActive ? (
          <PartStage
            partsForSelection={filteredPartsForSelection}
            pendingParts={[]}
            onPartSelect={(part) => setEditingPartId(part.id)}
            onPartQuantitySet={() => undefined}
            onQuantityPickerPreviewChange={() => undefined}
            onEditPart={setEditingPartId}
            selectedMaterialId={selectedMaterialId}
            selectedSize={selectedSize}
            selectedCategory={selectedCategory}
            onContinueToReview={() => undefined}
            actionMode="edit"
            title="Matching Parts"
            actionLabel="Edit"
          />
        ) : wizardStage === "catalog" && (
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
        )}

        {!isWizardSearchActive && wizardStage === "material" && hasCatalogSelection && (
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

        {!isWizardSearchActive && wizardStage === "size" && hasCatalogSelection && hasMaterialSelection && (
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
            allUnits={(allUnits ?? []).map((u) => ({ id: u.id, code: u.code }))}
            onCreateSize={createSize}
          />
        )}

        {!isWizardSearchActive && wizardStage === "category" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection && (
          <CategoryStage
            categories={categoriesWithCounts}
            selectedCategory={selectedCategory}
            allSelected={hasCategorySelection && selectedCategory?.categoryId === null}
            onCategorySelect={handleCategorySelection}
            showCustomCategoryInput={showCustomCategoryInput}
            onShowCustomCategoryInput={setShowCustomCategoryInput}
            customCategoryName={customCategoryName}
            onCustomCategoryNameChange={setCustomCategoryName}
            onCustomCategorySubmit={handleCustomCategorySubmit}
          />
        )}

        {!isWizardSearchActive && wizardStage === "part" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection && hasCategorySelection && (
          <PartStage
            partsForSelection={filteredPartsForSelection}
            pendingParts={[]}
            onPartSelect={(part) => setEditingPartId(part.id)}
            onPartQuantitySet={() => undefined}
            onQuantityPickerPreviewChange={() => undefined}
            onEditPart={setEditingPartId}
            selectedMaterialId={selectedMaterialId}
            selectedSize={selectedSize}
            selectedCategory={selectedCategory}
            onContinueToReview={() => undefined}
            actionMode="edit"
            title="Parts"
            actionLabel="Edit"
          />
        )}
      </div>

      <EditPartDialog
        open={editingPartId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPartId(null);
        }}
        partId={editingPartId}
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
