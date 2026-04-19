export interface OfflineCatalogueCatalog {
  id: string;
  name: string;
  sortOrder: number;
  organizationId: string;
  partCount?: number;
}

export interface OfflineCatalogueMaterial {
  id: string;
  name: string;
}

export interface OfflineCatalogueCategory {
  id: string;
  name: string;
  sortOrder: number;
  organizationId: string;
  partCount?: number;
}

export interface OfflineCatalogueUnit {
  id: string;
  code: string;
  displayName: string | null;
  kind: string;
}

export interface OfflineCataloguePart {
  id: string;
  displayName: string;
  description: string | null;
  imageUrl: string | null;
  material: string | null;
  materialId: string | null;
  size: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  catalogId: string;
  categoryId: string | null;
  isOrgSpecific: boolean;
}

export interface OfflineCatalogueSnapshotData {
  catalogs: OfflineCatalogueCatalog[];
  materials: OfflineCatalogueMaterial[];
  categories: OfflineCatalogueCategory[];
  allUnits: OfflineCatalogueUnit[];
  parts: OfflineCataloguePart[];
}

export interface OfflineCatalogueSnapshotEnvelope {
  version: 1;
  updatedAt: string;
  data: OfflineCatalogueSnapshotData;
}

const STORAGE_KEY = "foremanhq.offline.catalogue-snapshot";

export function getOfflineCatalogueSnapshot(): OfflineCatalogueSnapshotEnvelope | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OfflineCatalogueSnapshotEnvelope;
  } catch {
    return null;
  }
}

export function setOfflineCatalogueSnapshot(data: OfflineCatalogueSnapshotData) {
  if (typeof window === "undefined") return;

  const envelope: OfflineCatalogueSnapshotEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}
