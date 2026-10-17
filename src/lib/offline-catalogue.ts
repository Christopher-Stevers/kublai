import { scheduleBackgroundWork } from "~/lib/background-work";

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
  groupPath?: string[];
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
  piecesPerPack?: number | null;
  bulkUnit?: string | null;
  individualUnit?: string | null;
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

const pendingImages = new Set<string>();
const warmedImages = new Set<string>();
const imageWarmupKey = "catalogue-images";

function scheduleImageBatch() {
  if (!pendingImages.size) return;
  scheduleBackgroundWork(imageWarmupKey, async () => {
    // Do not hold up optional feature warmups waiting indefinitely for SW activation.
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = navigator.serviceWorker.controller ?? registration?.active;
    if (!worker) {
      scheduleImageBatch();
      return;
    }
    const urls = [...pendingImages].slice(0, 8);
    const completed = await new Promise<string[] | null>((resolve) => {
      const channel = new MessageChannel();
      const finish = (cached: string[] | null) => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(cached);
      };
      const timeout = setTimeout(() => finish(null), 30_000);
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        finish(
          data &&
            typeof data === "object" &&
            "cached" in data &&
            Array.isArray(data.cached)
            ? data.cached.filter(
                (url): url is string => typeof url === "string",
              )
            : null,
        );
      };
      worker.postMessage({ type: "FOREMENHQ_CACHE_CATALOGUE_IMAGES", urls }, [
        channel.port2,
      ]);
    });
    if (completed) {
      // A missing photo must not stall every remaining photo. Failed URLs can
      // retry on the next catalogue snapshot; successful ones stay deduplicated.
      for (const url of urls) pendingImages.delete(url);
      for (const url of completed) warmedImages.add(url);
    }
    // A failed/offline batch stays pending for the next online/catalogue event.
    if (completed) scheduleImageBatch();
  });
}
let listeningForImages = false;
export async function warmOfflineCatalogueImages(data: {
  parts: Array<{ imageUrl?: string | null }>;
}) {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  for (const url of getCacheableCatalogueImageUrls(data.parts).slice(0, 1000)) {
    if (!warmedImages.has(url)) pendingImages.add(url);
  }
  if (!listeningForImages) {
    listeningForImages = true;
    window.addEventListener("online", scheduleImageBatch);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      scheduleImageBatch,
    );
  }
  scheduleImageBatch();
}

export function clearLegacyOfflineCatalogueSnapshot() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
