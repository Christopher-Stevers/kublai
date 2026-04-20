"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { EditPartDialog } from "~/components/catalogue/EditPartDialog";
import { CreateCustomPartDialog } from "~/components/materialLists/CreateCustomPartDialog";
import { CatalogStage } from "~/components/materialLists/wizard/CatalogStage";
import { MaterialStage } from "~/components/materialLists/wizard/MaterialStage";
import { SizeStage } from "~/components/materialLists/wizard/SizeStage";
import { PartTypeCategoryStage } from "~/components/materialLists/wizard/PartTypeCategoryStage";
import { PartStage } from "~/components/materialLists/wizard/PartStage";
import { WizardHeader } from "~/components/materialLists/WizardHeader";
import { usePartWizard } from "~/components/materialLists/wizard/use-part-wizard";

export default function CataloguePage() {
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isCreatePartDialogOpen, setIsCreatePartDialogOpen] = useState(false);

  const {
    wizardStage,
    selectedCatalogId,
    hasCatalogSelection,
    selectedMaterialId,
    hasMaterialSelection,
    selectedSize,
    hasSizeSelection,
    selectedPartTypeCategory,
    hasCategorySelection,
    setSelectedPartTypeCategory,
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
    showCustomPartTypeInput,
    setShowCustomPartTypeInput,
    customPartTypeName,
    setCustomPartTypeName,
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
    handlePartTypeCategorySelection,
    handleCustomCategorySubmit,
    handleStageClick,
    selectedCatalogName,
    selectedMaterialName,
    selectedSizeName,
    selectedCategoryName,
    filteredPartsForSelection,
    wizardSearchPlaceholder,
  } = usePartWizard();

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      <div className="border-b bg-white p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Parts Catalogue</h1>
        </div>
        <WizardHeader
          currentStage={wizardStage}
          selectedCatalog={selectedCatalogName}
          selectedMaterial={selectedMaterialName}
          selectedSize={selectedSizeName}
          selectedPartTypeCategory={selectedCategoryName}
          onStageClick={handleStageClick}
          searchQuery={wizardSearchQuery}
          onSearchChange={setWizardSearchQuery}
          searchPlaceholder={wizardSearchPlaceholder}
          hideSearch={wizardStage === "part"}
          actionLabel="Create Part"
          onActionClick={() => setIsCreatePartDialogOpen(true)}
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">
        {wizardStage === "catalog" && (
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

        {wizardStage === "material" && hasCatalogSelection && (
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

        {wizardStage === "size" && hasCatalogSelection && hasMaterialSelection && (
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

        {wizardStage === "partTypeCategory" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection && (
          <PartTypeCategoryStage
            partTypeCategories={categoriesWithCounts}
            selectedPartTypeCategory={selectedPartTypeCategory}
            allSelected={hasCategorySelection && selectedPartTypeCategory?.categoryId === null}
            onPartTypeCategorySelect={handlePartTypeCategorySelection}
            showCustomPartTypeInput={showCustomPartTypeInput}
            onShowCustomPartTypeInput={setShowCustomPartTypeInput}
            customPartTypeName={customPartTypeName}
            onCustomPartTypeNameChange={setCustomPartTypeName}
            onCustomCategorySubmit={handleCustomCategorySubmit}
          />
        )}

        {wizardStage === "part" && hasCatalogSelection && hasMaterialSelection && hasSizeSelection && hasCategorySelection && (
          <PartStage
            partsForSelection={filteredPartsForSelection}
            pendingParts={[]}
            onPartSelect={(part) => setEditingPartId(part.id)}
            onPartQuantitySet={() => undefined}
            onQuantityPickerPreviewChange={() => undefined}
            onEditPart={setEditingPartId}
            selectedMaterialId={selectedMaterialId}
            selectedSize={selectedSize}
            selectedPartTypeCategory={selectedPartTypeCategory}
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
          categoryId: selectedPartTypeCategory?.categoryId ?? null,
          categoryName: selectedPartTypeCategory?.name ?? null,
        }}
      />
    </div>
  );
}
