import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInstantPartImage } from "./use-instant-part-image";
import type { RouterOutputs } from "~/trpc/react";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  invalidate: vi.fn(),
  pull: vi.fn(),
  notify: vi.fn(),
  account: { accountKey: "org:actor", userId: "actor" },
  authority: {} as object,
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/lib/replicache-catalogue", () => ({
  requestCatalogueReplicachePull: state.pull,
}));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: state.notify }));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_procedure: unknown, input: { partId: string }) => [
    "part",
    input.partId,
  ],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    catalogue: { getPart: {} },
    useUtils: () => ({
      client: { catalogue: { updatePart: { mutate: state.save } } },
      catalogue: {
        getPart: { invalidate: state.invalidate },
        searchParts: { invalidate: state.invalidate },
        getPartWizardSummary: { invalidate: state.invalidate },
      },
    }),
  },
}));
type Part = RouterOutputs["catalogue"]["getPart"];
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const oldImage = "/images/catalog/uploads/old.webp",
  nextImage = "/images/catalog/uploads/new.webp";
function part(): Part {
  return {
    id,
    displayName: "Fixture part",
    imageUrl: oldImage,
    approvedImageUrl: oldImage,
    isOrgSpecific: true,
    piecesPerPack: null,
    bulkUnit: null,
    individualUnit: null,
    description: null,
    catalogId: "catalog",
    categoryId: null,
    materialId: null,
    material: null,
    sizeNominal: null,
    sizeLabel: null,
    sizeUnitId: null,
    isActive: true,
    assetTracking: null,
    sizeUnit: null,
    aliases: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(["part", id], part());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ partId, enabled }) => {
      const [image, setImage] = useState(oldImage),
        [picker, setPicker] = useState(true);
      const action = useInstantPartImage({
        partId,
        enabled,
        visibleImage: image,
        onPreview: (url) => {
          setImage(url);
          setPicker(false);
        },
        onRestore: setImage,
      });
      return { ...action, image, picker, setImage };
    },
    { wrapper, initialProps: { partId: id, enabled: true } },
  );
  return { client, hook };
}
beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  state.account = { accountKey: "org:actor", userId: "actor" };
  state.authority = {};
  for (const fn of [state.save, state.invalidate, state.pull, state.notify])
    fn.mockReset();
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

it("previews a stored image and closes its picker before acknowledgment, sends only photo fields and reconciles acceptance", async () => {
  const request = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(request.promise);
  const { client, hook } = setup();
  const normalized = "/images/catalog/uploads/normalized.webp";
  let save!: Promise<unknown>;
  act(() => {
    save = hook.result.current.attach(nextImage);
    expect(client.getQueryData<Part>(["part", id])?.imageUrl).toBe(nextImage);
    expect(client.getQueryData<Part>(["part", id])?.approvedImageUrl).toBe(
      oldImage,
    );
    expect(hook.result.current.hasPending()).toBe(true);
  });
  expect(hook.result.current.image).toBe(nextImage);
  expect(hook.result.current.picker).toBe(false);
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledExactlyOnceWith({
      partId: id,
      imageUrl: nextImage,
      expectedAccountKey: "org:actor",
    }),
  );
  await act(async () => {
    request.resolve({ id, imageUrl: normalized });
    await save;
  });
  expect(client.getQueryData<Part>(["part", id])?.approvedImageUrl).toBe(
    normalized,
  );
  expect(hook.result.current.image).toBe(normalized);
  expect(hook.result.current.hasPending()).toBe(false);
  expect(state.pull).toHaveBeenCalledOnce();
});
it("rolls a refusal back and retains the attempted URL for explicit retry", async () => {
  state.save.mockRejectedValue(new Error("Forbidden"));
  const { client, hook } = setup();
  await act(async () => {
    await hook.result.current.attach(nextImage).catch(() => undefined);
  });
  expect(client.getQueryData<Part>(["part", id])?.imageUrl).toBe(oldImage);
  expect(hook.result.current.image).toBe(oldImage);
  expect(hook.result.current.failedImage).toBe(nextImage);
});
it("does not replace a newer authoritative photo or an independently edited local draft", async () => {
  const request = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(request.promise);
  const { client, hook } = setup();
  let save!: Promise<unknown>;
  act(() => {
    save = hook.result.current.attach(nextImage);
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const serverImage = "/images/catalog/uploads/newer.webp";
  act(() => {
    client.setQueryData(["part", id], { ...part(), imageUrl: serverImage });
  });
  await act(async () => {
    request.reject(new Error("Refused"));
    await save.catch(() => undefined);
  });
  expect(hook.result.current.image).toBe(serverImage);
  expect(client.getQueryData<Part>(["part", id])?.imageUrl).toBe(serverImage);
  const second = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(second.promise);
  act(() => {
    save = hook.result.current.attach(nextImage);
  });
  act(() => hook.result.current.setImage("my unsaved draft"));
  await act(async () => {
    second.reject(new Error("Refused"));
    await save.catch(() => undefined);
  });
  expect(hook.result.current.image).toBe("my unsaved draft");
});
it("refuses global, missing or unstored-photo previews without a request", async () => {
  for (const mode of ["global", "missing", "remote"]) {
    const { client, hook } = setup();
    if (mode === "global")
      client.setQueryData(["part", id], { ...part(), isOrgSpecific: false });
    if (mode === "missing") client.removeQueries({ queryKey: ["part", id] });
    await act(async () => {
      await hook.result.current
        .attach(
          mode === "remote" ? "https://example.invalid/new.webp" : nextImage,
        )
        .catch(() => undefined);
    });
    expect(state.save).not.toHaveBeenCalled();
    expect(hook.result.current.image).toBe(oldImage);
    hook.unmount();
  }
});
it("cannot attach a completed upload after account or selected part changes", async () => {
  const { hook } = setup();
  const attach = hook.result.current.captureUpload();
  state.authority = {};
  state.account = { accountKey: "org:other", userId: "other" };
  hook.rerender({ partId: other, enabled: true });
  await act(async () => {
    await attach(nextImage);
  });
  expect(state.save).not.toHaveBeenCalled();
  expect(hook.result.current.image).toBe(oldImage);
});
it("does not resurrect cleared account cache after a late accepted response", async () => {
  const request = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(request.promise);
  const { client, hook } = setup();
  let save!: Promise<unknown>;
  act(() => {
    save = hook.result.current.attach(nextImage);
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  act(() => {
    client.clear();
    state.authority = {};
  });
  await act(async () => {
    request.resolve({ id, imageUrl: nextImage });
    await save;
  });
  expect(client.getQueryData(["part", id])).toBeUndefined();
  expect(state.pull).not.toHaveBeenCalled();
});
it("rejects offline attempts without preview, transport or reconnect replay", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const { hook } = setup();
  await act(async () => {
    await hook.result.current.attach(nextImage).catch(() => undefined);
  });
  expect(state.save).not.toHaveBeenCalled();
  expect(hook.result.current.image).toBe(oldImage);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(state.save).not.toHaveBeenCalled();
});

it("refuses a second pending photo without issuing a duplicate write or losing the first preview", async () => {
  const request = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(request.promise);
  const { client, hook } = setup();
  let first!: Promise<unknown>;
  act(() => {
    first = hook.result.current.attach(nextImage);
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  await act(async () => {
    await hook.result.current
      .attach("/images/catalog/uploads/second.webp")
      .catch(() => undefined);
  });
  expect(state.save).toHaveBeenCalledOnce();
  expect(client.getQueryData<Part>(["part", id])?.imageUrl).toBe(nextImage);
  expect(hook.result.current.hasPending()).toBe(true);
  await act(async () => {
    request.resolve({ id, imageUrl: nextImage });
    await first;
  });
  expect(hook.result.current.hasPending()).toBe(false);
});
it("does not pretend a different-ID server result attached the original part", async () => {
  state.save.mockResolvedValue({ id: other, imageUrl: nextImage });
  const { client, hook } = setup();
  await act(async () => {
    await hook.result.current.attach(nextImage).catch(() => undefined);
  });
  expect(client.getQueryData<Part>(["part", id])?.imageUrl).toBe(oldImage);
  expect(hook.result.current.image).toBe(oldImage);
  expect(hook.result.current.failedImage).toBeNull();
});
it("restores the prior unsaved image draft on refusal, rather than replacing it with older saved input", async () => {
  state.save.mockRejectedValue(new Error("Refused"));
  const { hook } = setup();
  act(() => hook.result.current.setImage("my earlier unsaved image"));
  await act(async () => {
    await hook.result.current.attach(nextImage).catch(() => undefined);
  });
  expect(hook.result.current.image).toBe("my earlier unsaved image");
  expect(hook.result.current.failedImage).toBe(nextImage);
});

it("does not send a late completed upload after the dialog unmounts", async () => {
  const { hook } = setup();
  const attach = hook.result.current.captureUpload();
  hook.unmount();
  await attach(nextImage);
  expect(state.save).not.toHaveBeenCalled();
});
it("lets an already-issued authorized attachment finish after removal without reviving a cleared cache", async () => {
  const request = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(request.promise);
  const { client, hook } = setup();
  let save!: Promise<unknown>;
  act(() => {
    save = hook.result.current.attach(nextImage);
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  hook.unmount();
  client.clear();
  await act(async () => {
    request.resolve({ id, imageUrl: nextImage });
    await save;
  });
  expect(client.getQueryData(["part", id])).toBeUndefined();
  expect(state.save).toHaveBeenCalledOnce();
});

it("refuses an ineligible/offline-test view even when navigator still reports online", async () => {
  const { hook } = setup();
  hook.rerender({ partId: id, enabled: false });
  await act(async () => {
    await hook.result.current.attach(nextImage).catch(() => undefined);
  });
  expect(state.save).not.toHaveBeenCalled();
  expect(hook.result.current.image).toBe(oldImage);
});

it("keeps the original account key in a dispatched payload even when the transport defers HTTP", async () => {
  const request = deferred<{ id: string; imageUrl: string }>();
  state.save.mockReturnValue(request.promise);
  const { client, hook } = setup();
  let save!: Promise<unknown>;
  act(() => {
    save = hook.result.current.attach(nextImage);
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const wire = state.save.mock.calls[0]![0] as { expectedAccountKey: string };
  state.account = {
    accountKey: "other:viewer:simulation:session",
    userId: "viewer",
  };
  state.authority = {};
  hook.rerender({ partId: id, enabled: true });
  expect(wire.expectedAccountKey).toBe("org:actor");
  act(() => client.clear());
  await act(async () => {
    request.reject(new Error("CONFLICT"));
    await save.catch(() => undefined);
  });
  expect(client.getQueryData(["part", id])).toBeUndefined();
});

it("refreshes the current account after an issued attachment settles even if the editor closes or switches part", async () => {
  for (const close of [false, true]) {
    const request = deferred<{ id: string; imageUrl: string }>();
    state.save.mockReturnValue(request.promise);
    const { client, hook } = setup();
    let save!: Promise<unknown>;
    act(() => {
      save = hook.result.current.attach(nextImage);
    });
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    hook.rerender({ partId: close ? id : other, enabled: !close });
    await act(async () => {
      request.resolve({
        id,
        imageUrl: "/images/catalog/uploads/accepted.webp",
      });
      await save;
    });
    expect(hook.result.current.image).toBe(nextImage);
    expect(client.getQueryData<Part>(["part", id])?.imageUrl).toBe(
      "/images/catalog/uploads/accepted.webp",
    );
    expect(state.pull).toHaveBeenCalledOnce();
    expect(state.invalidate).toHaveBeenCalledWith({ partId: id });
    hook.unmount();
    state.pull.mockClear();
    state.invalidate.mockClear();
    state.save.mockClear();
  }
});
