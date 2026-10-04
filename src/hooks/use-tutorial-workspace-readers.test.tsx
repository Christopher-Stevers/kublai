import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import {
  useReplicacheJob,
  useReplicacheJobDetail,
  useReplicacheJobsList,
} from "./use-replicache-jobs";
import {
  useReplicacheMaterialList,
  useReplicacheSyncing,
} from "./use-replicache-material-list";
import {
  useCatalogueFirstDownload,
  useReplicacheCatalogue,
} from "./use-replicache-catalogue";
import { useReplicacheSuppliers } from "./use-replicache-suppliers";

const mocks = vi.hoisted(() => ({
  sandbox: null as TutorialSandbox | null,
  material: vi.fn(),
  catalogue: vi.fn(),
  sync: vi.fn(),
  catalogueSync: vi.fn(),
  warm: vi.fn(),
}));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => mocks.sandbox,
}));
vi.mock("~/lib/replicache-material-list", () => ({
  tryGetMaterialListReplicache: mocks.material,
  subscribeToMaterialListReplicacheSyncing: mocks.sync,
}));
vi.mock("~/lib/replicache-catalogue", () => ({
  tryGetCatalogueReplicache: mocks.catalogue,
  subscribeCatalogueSyncing: mocks.catalogueSync,
  getCatalogueSyncing: () => false,
}));
vi.mock("~/lib/offline-catalogue", () => ({
  warmOfflineCatalogueImages: mocks.warm,
}));
afterEach(() => {
  cleanup();
  mocks.sandbox = null;
  vi.clearAllMocks();
});

describe("tutorial workspace readers", () => {
  it("all readers subscribe only to the scoped databases without opening live stores or warming real caches", () => {
    const materialSubscribe = vi.fn(() => () => undefined);
    const catalogueSubscribe = vi.fn(() => () => undefined);
    mocks.sandbox = {
      material: {
        subscribe: materialSubscribe,
      } as unknown as TutorialSandbox["material"],
      catalogue: {
        subscribe: catalogueSubscribe,
      } as unknown as TutorialSandbox["catalogue"],
      userId: "demo-user",
      runId: "demo-run",
    };
    const { result } = renderHook(() => ({
      jobs: useReplicacheJobsList(),
      job: useReplicacheJob("demo-job"),
      detail: useReplicacheJobDetail("demo-job"),
      list: useReplicacheMaterialList("demo-list"),
      suppliers: useReplicacheSuppliers(),
      catalogue: useReplicacheCatalogue(),
      syncing: useReplicacheSyncing(),
      downloading: useCatalogueFirstDownload(),
    }));
    expect(result.current.jobs).toEqual([]);
    expect(result.current.suppliers).toEqual([]);
    expect(result.current.syncing).toBe(false);
    expect(result.current.downloading).toBe(false);
    expect(materialSubscribe).toHaveBeenCalledTimes(5);
    expect(catalogueSubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.material).not.toHaveBeenCalled();
    expect(mocks.catalogue).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.catalogueSync).not.toHaveBeenCalled();
    expect(mocks.warm).not.toHaveBeenCalled();
  });

  it("disabled catalogue and supplier readers open neither sandbox nor live databases", () => {
    const subscribe = vi.fn();
    mocks.sandbox = {
      material: { subscribe } as unknown as TutorialSandbox["material"],
      catalogue: { subscribe } as unknown as TutorialSandbox["catalogue"],
      userId: "demo",
      runId: "run",
    };
    renderHook(() => {
      useReplicacheCatalogue({ enabled: false });
      useReplicacheSuppliers({ enabled: false });
    });
    expect(subscribe).not.toHaveBeenCalled();
    expect(mocks.material).not.toHaveBeenCalled();
    expect(mocks.catalogue).not.toHaveBeenCalled();
  });
});
