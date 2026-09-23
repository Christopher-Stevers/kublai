"use client";
import { useEffect, useMemo, useState } from "react";
import { useReplicacheCatalogue } from "~/hooks/use-replicache-catalogue";
import type { ReplicacheMaterialListItem } from "~/hooks/use-replicache-material-list";
import type { ReplicacheSupplier } from "~/hooks/use-replicache-suppliers";
import {
  type NameKeywordGroup,
  isMaterialListSort,
  sortMaterialListItems,
  type MaterialListSort,
} from "~/lib/material-list-sort";
import {
  NAME_KEYWORDS_KEY as KEYWORDS_KEY,
  SHARED_NAME_KEYWORD_GROUPS,
  loadNameKeywordGroups,
} from "~/lib/name-keyword-defaults";
const PREFERENCE_EVENT = "foremenhq-sort-preferences-changed";
const STORAGE_KEY = "foremenhq.material-list-sort";
export function useMaterialListSortPreference() {
  const [sortMode, setMode] = useState<MaterialListSort>("material");
  const [keywordGroups, setGroups] = useState<readonly NameKeywordGroup[]>(
    SHARED_NAME_KEYWORD_GROUPS,
  );
  useEffect(() => {
    const readPreferences = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        setMode(isMaterialListSort(saved) ? saved : "material");
        setGroups(loadNameKeywordGroups(localStorage));
      } catch {
        /* Sorting still works when browser storage is unavailable. */
      }
    };
    readPreferences();
    window.addEventListener("storage", readPreferences);
    window.addEventListener(PREFERENCE_EVENT, readPreferences);
    return () => {
      window.removeEventListener("storage", readPreferences);
      window.removeEventListener(PREFERENCE_EVENT, readPreferences);
    };
  }, []);
  const setSortMode = (mode: MaterialListSort) => {
    setMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
      window.dispatchEvent(new Event(PREFERENCE_EVENT));
    } catch {
      /* Keep session choice. */
    }
  };
  const setKeywordGroups = (groups: readonly NameKeywordGroup[]) => {
    setGroups(groups);
    try {
      localStorage.setItem(KEYWORDS_KEY, JSON.stringify(groups));
      window.dispatchEvent(new Event(PREFERENCE_EVENT));
    } catch {
      /* Keep session choice when storage is unavailable. */
    }
  };
  return { sortMode, setSortMode, keywordGroups, setKeywordGroups };
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
