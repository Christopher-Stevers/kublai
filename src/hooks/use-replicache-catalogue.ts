"use client";

import { useCallback, useEffect } from "react";
import type { ReadonlyJSONValue } from "replicache";
import { tryGetCatalogueReplicache } from "~/lib/replicache-catalogue";
import { useReplicacheSubscribe } from "~/hooks/use-replicache-subscribe";
import { warmOfflineCatalogueImages } from "~/lib/offline-catalogue";

export interface ReplicacheCatalogueCatalog {
  id: string;
  name: string;
  sortOrder: number;
  organizationId: string;
}

export interface ReplicacheCatalogueMaterial {
  id: string;
  name: string;
}

export interface ReplicacheCatalogueCategory {
  id: string;
  name: string;
  sortOrder: number;
  organizationId: string;
}

export interface ReplicacheCatalogueUnit {
  id: string;
  code: string;
  displayName: string | null;
  kind: string;
}

export interface ReplicacheCataloguePart {
  id: string;
  displayName: string;
  description: string | null;
  imageUrl: string | null;
  material: string | null;
  materialId: string | null;
  size: string | null;
  sizeLabel?: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  catalogId: string;
  categoryId: string | null;
  sortOrder?: number;
  isOrgSpecific: boolean;
}

export interface ReplicacheCatalogueSnapshot {
  catalogs: ReplicacheCatalogueCatalog[];
  materials: ReplicacheCatalogueMaterial[];
  categories: ReplicacheCatalogueCategory[];
  allUnits: ReplicacheCatalogueUnit[];
  parts: ReplicacheCataloguePart[];
}

const EMPTY_SNAPSHOT: ReplicacheCatalogueSnapshot = {
  catalogs: [],
  materials: [],
  categories: [],
  allUnits: [],
  parts: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isCatalog(value: unknown): value is ReplicacheCatalogueCatalog {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.organizationId === "string"
  );
}

function isMaterial(value: unknown): value is ReplicacheCatalogueMaterial {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isCategory(value: unknown): value is ReplicacheCatalogueCategory {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.organizationId === "string"
  );
}

function isUnit(value: unknown): value is ReplicacheCatalogueUnit {
  return isRecord(value) && typeof value.id === "string" && typeof value.code === "string";
}

function isPart(value: unknown): value is ReplicacheCataloguePart {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.catalogId === "string"
  );
}

function readTyped<T>(
  values: readonly ReadonlyJSONValue[],
  guard: (value: unknown) => value is T,
): T[] {
  const result: T[] = [];
  for (const value of values) {
    if (guard(value)) result.push(value);
  }
  return result;
}

export function useReplicacheCatalogue({
  enabled = true,
}: { enabled?: boolean } = {}): ReplicacheCatalogueSnapshot {
  const rep = enabled ? tryGetCatalogueReplicache() : null;

  const snapshot = useReplicacheSubscribe<ReplicacheCatalogueSnapshot, never>(
    rep as never,
    useCallback(async (tx) => {
      const [catalogEntries, materialEntries, categoryEntries, unitEntries, partEntries] =
        await Promise.all([
          tx.scan({ prefix: "catalog/" }).values().toArray(),
          tx.scan({ prefix: "catalogueMaterial/" }).values().toArray(),
          tx.scan({ prefix: "category/" }).values().toArray(),
          tx.scan({ prefix: "unit/" }).values().toArray(),
          tx.scan({ prefix: "cataloguePart/" }).values().toArray(),
        ]);

      const nextSnapshot: ReplicacheCatalogueSnapshot = {
        catalogs: readTyped(catalogEntries, isCatalog).sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        }),
        materials: readTyped(materialEntries, isMaterial).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        categories: readTyped(categoryEntries, isCategory).sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        }),
        allUnits: readTyped(unitEntries, isUnit).sort((a, b) =>
          a.code.localeCompare(b.code),
        ),
        parts: readTyped(partEntries, isPart),
      };
      return nextSnapshot;
    }, []),
    { default: EMPTY_SNAPSHOT },
  );

  useEffect(() => {
    if (snapshot.parts.length === 0) return;
    void warmOfflineCatalogueImages({
      parts: snapshot.parts,
    });
  }, [snapshot]);

  return snapshot;
}
