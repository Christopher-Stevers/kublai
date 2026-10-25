"use client";
import { useMemo } from "react";
import { useMaterialSortContext } from "~/components/app/MaterialSortProvider";
import { useReplicacheCatalogue } from "~/hooks/use-replicache-catalogue";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import type { ReplicacheMaterialListItem } from "~/hooks/use-replicache-material-list";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";
import { sortMaterialListItems } from "~/lib/material-list-sort";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
export function useMaterialListSortPreference() {
  const context = useMaterialSortContext();
  const readOnly = !!useTutorialSandbox();
  const fallback = {
    ...defaultMaterialSortSettings,
    editorSettings: defaultMaterialSortSettings,
    custom: false,
    editingExecutive: false,
    canEditExecutive: false,
    editable: false,
    saving: false,
    error: "",
    setEditingExecutive: () => {},
    setCustom: () => {},
    setSortMode: () => {},
    setKeywordGroups: () => {},
  };
  const value = context ?? fallback;
  return readOnly
    ? {
        ...value,
        editable: false,
        setCustom: fallback.setCustom,
        setSortMode: fallback.setSortMode,
        setKeywordGroups: fallback.setKeywordGroups,
      }
    : value;
}

export function useMaterialListSort(
  items: ReplicacheMaterialListItem[],
  suppliers: ReplicacheSupplier[],
) {
  const { sortMode, setSortMode, keywordGroups } =
    useMaterialListSortPreference();
  const { parts, categories, catalogs } = useReplicacheCatalogue({
    enabled: items.length > 0,
  });
  const sortedItems = useMemo(
    () =>
      sortMaterialListItems(
        items,
        sortMode,
        parts,
        suppliers,
        categories,
        keywordGroups,
        catalogs,
      ),
    [items, sortMode, parts, suppliers, categories, keywordGroups, catalogs],
  );
  return { sortedItems, sortMode, setSortMode };
}
