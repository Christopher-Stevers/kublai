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

const STORAGE_KEY = "foremanhq.offline.catalogue-snapshot";

function getCacheableCatalogueImageUrls(
  parts: Array<{ imageUrl?: string | null }>,
) {
  const urls = new Set<string>();

  for (const part of parts) {
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

export async function warmOfflineCatalogueImages(data: {
  parts: Array<{ imageUrl?: string | null }>;
}) {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const urls = getCacheableCatalogueImageUrls(data.parts);
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

export function clearLegacyOfflineCatalogueSnapshot() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
