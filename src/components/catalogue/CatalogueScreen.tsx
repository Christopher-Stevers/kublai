"use client";
import {
  EditPartDialog,
  CreateCustomPartDialog,
  MaterialGroupsDialog,
  PhotoQueueDialog,
  AddPartDialog,
} from "~/components/app/DeferredFeatures";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { QuickWheelSurface } from "~/components/materialLists/wizard/QuickWheel";
import { CatalogStage } from "~/components/materialLists/wizard/CatalogStage";
import { MaterialStage } from "~/components/materialLists/wizard/MaterialStage";
import { SizeStage } from "~/components/materialLists/wizard/SizeStage";
import { CategoryStage } from "~/components/materialLists/wizard/CategoryStage";
import { PartStage } from "~/components/app/DeferredFeatures";
import { WizardHeader } from "~/components/materialLists/WizardHeader";
import {
  usePartWizard,
  type WizardCatalogKind,
} from "~/components/materialLists/wizard/use-part-wizard";
import {
  downloadCatalogueRowsAsXlsx,
  readCatalogueImportWorkbook,
} from "~/lib/catalogue-xlsx";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER } from "~/lib/server-connection-mode";
import {
  Download,
  Ellipsis,
  Grid2X2,
  Images,
  Search,
  Upload,
} from "lucide-react";
import { confirmAction, notify } from "~/components/ui/app-dialogs";

/**
 * The catalogue screen. "materials" is the Catalogue tab; "assets" shows the
 * tool types managed from Asset Management with the same tools and dialogs.
 */
export function CatalogueScreen({
  catalogKind = "materials",
}: {
  catalogKind?: WizardCatalogKind;
}) {
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [isCreatePartDialogOpen, setIsCreatePartDialogOpen] = useState(false);
  const [isPrefabsOpen, setIsPrefabsOpen] = useState(false);
  const [isPhotoQueueOpen, setIsPhotoQueueOpen] = useState(false);
  const [isMaterialGroupsOpen, setIsMaterialGroupsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportOptionsOpen, setIsExportOptionsOpen] = useState(false);
  const [exportCatalogId, setExportCatalogId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [isPreparingImport, setIsPreparingImport] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number>();
  const workbookTask = useRef<{
    kind: "import" | "export";
    controller: AbortController;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isBrowserOnline = useOnlineStatus();
  const isCatalogueOnline =
    isBrowserOnline && !TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER;
  const utils = api.useUtils();
  const { data: orderWheelUsage } = api.catalogue.recentOrderWheelUsage.useQuery(undefined, { staleTime: 60_000 });
  const { data: roleData } = api.user.getMyRole.useQuery();
  const canEditParts = roleData?.permissions.canEditParts ?? false;

  // Fit the workspace above the phone keyboard and below its surrounding
  // navigation. Only the selection area scrolls; bottom controls stay reachable.
  useEffect(() => {
    if (!isCatalogueOnline) return;
    const resize = () => {
      if (!panelRef.current) return;
      const viewport = window.visualViewport;
      setPanelHeight(
        Math.max(
          0,
          (viewport?.offsetTop ?? 0) +
            (viewport?.height ?? window.innerHeight) -
            panelRef.current.getBoundingClientRect().top,
        ),
      );
    };
    const frame = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [isCatalogueOnline]);

  const cancelPreparation = useCallback(() => {
    workbookTask.current?.controller.abort();
    workbookTask.current = null;
    setIsImporting(false);
    setIsExporting(false);
    setIsPreparingImport(false);
    setImportProgress(null);
    setExportProgress(null);
  }, []);
  useEffect(
    () => () => {
      workbookTask.current?.controller.abort();
      workbookTask.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!canEditParts || !isCatalogueOnline) cancelPreparation();
  }, [canEditParts, isCatalogueOnline, cancelPreparation]);

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
  } = usePartWizard(true, undefined, undefined, catalogKind);

  const catalogOptions = catalogs ?? [];
  const isWizardSearchActive =
    wizardStage !== "review" && wizardSearchQuery.trim().length > 0;
  const centerOptionCards =
    !isWizardSearchActive &&
    ["catalog", "material", "size", "category"].includes(wizardStage);
  const barButton =
    "h-9 min-h-9 w-full rounded-lg px-1.5 py-1 text-xs leading-tight whitespace-normal";
  const handleExportClick = () => {
    if (workbookTask.current || !canEditParts || !isCatalogueOnline) return;
    setExportCatalogId(null);
    setIsExportOptionsOpen(true);
  };

  const handleExport = async () => {
    if (workbookTask.current || !canEditParts || !isCatalogueOnline) return;
    const task = { kind: "export" as const, controller: new AbortController() };
    workbookTask.current = task;
    const signal = task.controller.signal;
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
      setExportProgress("Loading catalogue rows…");
      const rows = await utils.catalogue.exportCatalogueRows.fetch({
        catalogId: exportCatalogId,
      });
      signal.throwIfAborted();
      setExportProgress("Preparing workbook…");
      await downloadCatalogueRowsAsXlsx(
        rows,
        `foremenhq-${filenameSuffix}.xlsx`,
        {
          signal,
          onProgress: (completed, total) => {
            if (!signal.aborted)
              setExportProgress(
                completed === total
                  ? "Writing workbook…"
                  : `Preparing ${completed} of ${total} rows…`,
              );
          },
        },
      );
      signal.throwIfAborted();
      setIsExportOptionsOpen(false);
    } catch (error) {
      if (
        !signal.aborted &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        notify("Catalogue export failed. Try again.", "error");
    } finally {
      if (workbookTask.current === task) {
        workbookTask.current = null;
        setIsExporting(false);
        setExportProgress(null);
      }
    }
  };

  const handleImportClick = () => {
    if (workbookTask.current || !canEditParts || !isCatalogueOnline) return;
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: { target: HTMLInputElement }) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (workbookTask.current || !canEditParts || !isCatalogueOnline) return;
    const task = { kind: "import" as const, controller: new AbortController() };
    workbookTask.current = task;
    const signal = task.controller.signal;

    try {
      setIsImporting(true);
      setIsPreparingImport(true);
      setImportProgress("Reading workbook...");
      const rows = await readCatalogueImportWorkbook(file, {
        signal,
        onProgress: (completed, total) => {
          if (!signal.aborted)
            setImportProgress(`Reading ${completed} of ${total} rows…`);
        },
      });
      signal.throwIfAborted();

      if (rows.length === 0) {
        notify(
          "No usable catalogue rows were found in that workbook.",
          "error",
        );
        return;
      }

      setImportProgress("Preparing local backup...");
      const existingRows = await utils.catalogue.exportCatalogueRows.fetch({
        catalogId: null,
      });
      signal.throwIfAborted();
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
        signal.throwIfAborted();

        if (!shouldContinue) {
          setImportProgress(null);
          return;
        }
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await downloadCatalogueRowsAsXlsx(
        existingRows,
        `foremenhq-catalogue-backup-${timestamp}.xlsx`,
        {
          signal,
          onProgress: (completed, total) => {
            if (!signal.aborted)
              setImportProgress(
                completed === total
                  ? "Writing local backup…"
                  : `Backing up ${completed} of ${total} rows…`,
              );
          },
        },
      );
      signal.throwIfAborted();
      // Cancellation is offered during preparation, before the first write.
      // Leaving the screen or losing access also stops subsequent upload batches.
      setIsPreparingImport(false);

      const batchSize = 50;
      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (let start = 0; start < rows.length; start += batchSize) {
        signal.throwIfAborted();
        const batch = rows.slice(start, start + batchSize);
        const batchNumber = Math.floor(start / batchSize) + 1;
        const batchCount = Math.ceil(rows.length / batchSize);
        setImportProgress(
          `Importing ${Math.min(start + batch.length, rows.length)} of ${rows.length} rows... (${batchNumber}/${batchCount})`,
        );

        const result = await importCatalogueRows.mutateAsync({ rows: batch });
        signal.throwIfAborted();
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
      signal.throwIfAborted();

      notify(
        `Catalogue import done. Created ${created}, updated ${updated}, skipped ${skipped}.`,
        "success",
      );
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      console.error("Catalogue import failed", error);
      notify(
        "Catalogue import failed. Check the workbook format and try again.",
        "error",
      );
    } finally {
      if (workbookTask.current === task) {
        workbookTask.current = null;
        setIsImporting(false);
        setIsPreparingImport(false);
        setImportProgress(null);
      }
    }
  };

  if (!isCatalogueOnline) {
    return (
      <div className="bg-muted/50 flex h-[calc(100vh-4rem)] items-center justify-center p-6">
        <div className="bg-card max-w-md rounded-2xl border p-6 text-center shadow-sm">
          <h1 className="text-foreground text-xl font-bold">
            Parts Catalogue is online-only
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Catalogue browsing, imports, exports, and edits require a server
            connection. Material-list field work can continue from local data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={catalogKind === "assets" ? "Tool Types" : "Parts Catalogue"}
      className="bg-canvas flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden sm:h-[calc(100dvh-4rem)]"
      style={panelHeight === undefined ? undefined : { height: panelHeight }}
    >
      <h1 className="sr-only">
        {catalogKind === "assets" ? "Tool Types" : "Parts Catalogue"}
      </h1>
      <div className="bg-card relative z-10 shrink-0 shadow-[0_2px_3px_rgba(0,0,0,0.35),0_6px_16px_rgba(0,0,0,0.6)]">
        <div className="mx-auto w-full max-w-6xl px-2 pt-1 pb-2 sm:px-4 sm:pb-3 md:px-6">
          <WizardHeader
            currentStage={wizardStage}
            selectedCatalog={selectedCatalogName}
            selectedMaterial={selectedMaterialName}
            selectedSize={selectedSizeName}
            selectedCategory={selectedCategoryName}
            onStageClick={handleStageClick}
            hideSearch
          />
        </div>
      </div>

      <QuickWheelSurface usage={orderWheelUsage} enabled={!editingPartId && !isWizardSearchActive && ["catalog", "material", "size", "category"].includes(wizardStage)}
        className={`@container mx-auto min-h-0 w-full max-w-6xl flex-1 space-y-2 overflow-y-auto overscroll-contain px-2 pt-2 pb-3 sm:space-y-4 sm:px-4 sm:pt-4 sm:pb-4 md:px-6 ${centerOptionCards ? "flex flex-col [&_.wizard-option-grid]:my-auto [&>*:last-child]:flex [&>*:last-child]:flex-1 [&>*:last-child]:flex-col" : ""}`}
      >
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
      </QuickWheelSurface>

      <input
        ref={fileInputRef}
        type="file"
        aria-label="Import catalogue workbook"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />
      <div className="bg-card shrink-0 border-t px-4 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-2">
        {importProgress && (
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p role="status" className="text-muted-foreground min-w-0 text-xs">
              {importProgress}
            </p>
            {isImporting && isPreparingImport && (
              <Button variant="ghost" size="sm" onClick={cancelPreparation}>
                Cancel preparation
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            variant="outline"
            className={barButton}
            disabled={!canEditParts}
            onClick={() => setIsCreatePartDialogOpen(true)}
          >
            Create Part
          </Button>
          <div className="relative min-w-0">
            <Search className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
            <Input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              name="catalogue-part-search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={wizardSearchQuery}
              onChange={(event) => setWizardSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="Search"
              aria-label="Search parts"
              className="h-9 w-full rounded-lg pl-8 text-sm [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={barButton}
                disabled={!canEditParts}
              >
                <Ellipsis className="mr-1 h-4 w-4 shrink-0" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="end"
              sideOffset={8}
              className="w-56"
            >
              <DropdownMenuItem
                disabled={!canEditParts}
                onSelect={() => setIsMaterialGroupsOpen(true)}
              >
                <Grid2X2 />
                Material groups
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canEditParts}
                onSelect={() => setIsPhotoQueueOpen(true)}
              >
                <Images />
                Photos
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsPrefabsOpen(true)}>
                <Grid2X2 />
                Prefabs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canEditParts || isImporting || isExporting}
                onSelect={handleImportClick}
              >
                <Upload />
                Import XLSX
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canEditParts || isImporting || isExporting}
                onSelect={handleExportClick}
              >
                <Download />
                Export XLSX
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog
        open={isExportOptionsOpen}
        onOpenChange={(open) => {
          if (!open && workbookTask.current?.kind === "export")
            cancelPreparation();
          setIsExportOptionsOpen(open);
        }}
      >
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
              disabled={isExporting}
              onClick={() => setExportCatalogId(null)}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                exportCatalogId === null
                  ? "bg-muted/50 text-foreground border-gray-900"
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
                  disabled={isExporting}
                  onClick={() => setExportCatalogId(catalog.id)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                    exportCatalogId === catalog.id
                      ? "bg-muted/50 text-foreground border-gray-900"
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

          {exportProgress && (
            <p role="status" className="text-muted-foreground text-sm">
              {exportProgress}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (workbookTask.current?.kind === "export")
                  cancelPreparation();
                setIsExportOptionsOpen(false);
              }}
            >
              {isExporting ? "Cancel export" : "Cancel"}
            </Button>
            <Button type="button" onClick={handleExport} disabled={isExporting}>
              {isExporting ? "Exporting..." : "Export XLSX"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditPartDialog
        catalogKind={catalogKind}
        open={editingPartId !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPartId(null);
        }}
        partId={editingPartId}
      />
      <MaterialGroupsDialog
        open={isMaterialGroupsOpen}
        onOpenChange={setIsMaterialGroupsOpen}
      />
      {isPrefabsOpen && <AddPartDialog open managePrefabs onOpenChange={setIsPrefabsOpen} />}
      <PhotoQueueDialog
        open={isPhotoQueueOpen}
        onOpenChange={setIsPhotoQueueOpen}
        catalogId={selectedCatalogId}
        materialId={selectedMaterialId}
        categoryId={selectedCategory?.categoryId}
      />
      <CreateCustomPartDialog
        catalogKind={catalogKind}
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
