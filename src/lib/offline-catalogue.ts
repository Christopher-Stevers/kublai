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
  sizeLabel?: string | null;
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
  version: 2;
  updatedAt: string;
  data: OfflineCatalogueSnapshotData;
}

const STORAGE_KEY = "foremanhq.offline.catalogue-snapshot";
const SNAPSHOT_VERSION = 2;

function getCacheableCatalogueImageUrls(data: OfflineCatalogueSnapshotData) {
  const urls = new Set<string>();

  for (const part of data.parts) {
    const imageUrl = part.imageUrl?.trim();
    if (!imageUrl) continue;

    if (
      imageUrl.startsWith("/api/catalogue/images/") ||
      imageUrl.startsWith("/images/")
    ) {
      urls.add(imageUrl);
    }
  }

  return Array.from(urls);
}

export async function warmOfflineCatalogueImages(
  data: OfflineCatalogueSnapshotData,
) {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const urls = getCacheableCatalogueImageUrls(data);
  if (urls.length === 0) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker =
      registration.active ??
      registration.waiting ??
      registration.installing ??
      navigator.serviceWorker.controller;

    worker?.postMessage({
      type: "FOREMENHQ_CACHE_CATALOGUE_IMAGES",
      urls,
    });
  } catch (error) {
    console.warn("Failed to warm offline catalogue images", error);
  }
}

export function getOfflineCatalogueSnapshot(): OfflineCatalogueSnapshotEnvelope | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const snapshot = JSON.parse(raw) as OfflineCatalogueSnapshotEnvelope;

    if (snapshot.version !== SNAPSHOT_VERSION) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

function updateOfflineCatalogueSnapshot(
  updater: (data: OfflineCatalogueSnapshotData) => OfflineCatalogueSnapshotData,
) {
  const current = getOfflineCatalogueSnapshot()?.data;
  if (!current) return;
  setOfflineCatalogueSnapshot(updater(current));
}

export function addOfflineCatalogueCatalog(catalog: OfflineCatalogueCatalog) {
  updateOfflineCatalogueSnapshot((data) => ({
    ...data,
    catalogs: [...data.catalogs.filter((item) => item.id !== catalog.id), catalog].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

export function addOfflineCatalogueCategory(category: OfflineCatalogueCategory) {
  updateOfflineCatalogueSnapshot((data) => ({
    ...data,
    categories: [...data.categories.filter((item) => item.id !== category.id), category].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

export function addOfflineCatalogueMaterial(material: OfflineCatalogueMaterial) {
  updateOfflineCatalogueSnapshot((data) => ({
    ...data,
    materials: [...data.materials.filter((item) => item.id !== material.id), material].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

export function setOfflineCatalogueSnapshot(data: OfflineCatalogueSnapshotData) {
  if (typeof window === "undefined") return;

  const envelope: OfflineCatalogueSnapshotEnvelope = {
    version: SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  void warmOfflineCatalogueImages(data);
}
