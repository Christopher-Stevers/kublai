import { Replicache, dropDatabase } from "replicache";

import { CATALOGUE_REPLICACHE_SCHEMA_VERSION } from "~/lib/replicache-schema";

let catalogueReplicache: Replicache | null = null;
let catalogueReplicacheClosing = false;
let catalogueReplicacheResetting = false;
let catalogueReplicachePullTimer: ReturnType<typeof setTimeout> | null = null;
let catalogueReplicachePullInFlight = false;
let catalogueReplicachePullRequested = false;

function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("Replicache catalogue sync is browser-only");
  }
}

function isReplicacheClosedError(error: unknown) {
  return error instanceof Error && error.message === "Closed";
}

export async function resetCatalogueReplicacheStorage() {
  if (catalogueReplicacheResetting) return;
  catalogueReplicacheResetting = true;

  if (catalogueReplicachePullTimer) {
    clearTimeout(catalogueReplicachePullTimer);
    catalogueReplicachePullTimer = null;
  }
  catalogueReplicachePullRequested = false;

  const staleReplicache = catalogueReplicache;
  const staleDbName = staleReplicache?.idbName;
  catalogueReplicache = null;
  catalogueReplicacheClosing = true;
  try {
    await staleReplicache?.close();
  } catch (error) {
    if (!isReplicacheClosedError(error)) throw error;
  } finally {
    catalogueReplicacheClosing = false;
  }

  if (staleDbName) await dropDatabase(staleDbName);
}

export function getCatalogueReplicache() {
  assertBrowser();
  if (catalogueReplicache) return catalogueReplicache;

  const replicache = new Replicache({
    name: "foremenhq-catalogue",
    schemaVersion: CATALOGUE_REPLICACHE_SCHEMA_VERSION,
    pullURL: "/api/replicache/catalogue/pull",
    pushURL: "/api/replicache/catalogue/push",
    pullInterval: 5 * 60_000,
    pushDelay: 60_000,
    mutators: {},
  });

  replicache.onClientStateNotFound = () => {
    void resetCatalogueReplicacheStorage();
  };

  catalogueReplicache = replicache;
  return catalogueReplicache;
}

export function tryGetCatalogueReplicache() {
  if (typeof window === "undefined") return null;
  try {
    return getCatalogueReplicache();
  } catch (error) {
    console.error("Failed to initialize Replicache catalogue sync", error);
    return null;
  }
}

async function flushCatalogueReplicachePull() {
  if (catalogueReplicacheClosing) return;
  if (catalogueReplicachePullInFlight) {
    catalogueReplicachePullRequested = true;
    return;
  }

  catalogueReplicachePullInFlight = true;
  const replicache = getCatalogueReplicache();
  try {
    await replicache.pull({ now: true });
  } catch (error) {
    if (!isReplicacheClosedError(error)) {
      console.error("Immediate catalogue Replicache pull failed", error);
    }
  } finally {
    catalogueReplicachePullInFlight = false;
    if (catalogueReplicachePullRequested) {
      catalogueReplicachePullRequested = false;
      requestCatalogueReplicachePull(0);
    }
  }
}

export function requestCatalogueReplicachePull(delayMs = 0) {
  assertBrowser();
  if (catalogueReplicachePullTimer) {
    clearTimeout(catalogueReplicachePullTimer);
  }
  catalogueReplicachePullTimer = setTimeout(() => {
    catalogueReplicachePullTimer = null;
    void flushCatalogueReplicachePull();
  }, delayMs);
}

export async function closeCatalogueReplicache() {
  if (catalogueReplicachePullTimer) {
    clearTimeout(catalogueReplicachePullTimer);
    catalogueReplicachePullTimer = null;
  }
  catalogueReplicachePullRequested = false;

  const replicache = catalogueReplicache;
  catalogueReplicache = null;
  if (!replicache) return;

  catalogueReplicacheClosing = true;
  try {
    await replicache.close();
  } catch (error) {
    if (!isReplicacheClosedError(error)) throw error;
  } finally {
    catalogueReplicacheClosing = false;
  }
}
