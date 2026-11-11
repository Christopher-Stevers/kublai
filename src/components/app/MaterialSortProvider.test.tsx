import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MaterialSortProvider,
  useMaterialSortContext,
} from "./MaterialSortProvider";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
type PreferenceState = {
  shared: typeof defaultMaterialSortSettings;
  personal: typeof defaultMaterialSortSettings | null;
  custom: boolean;
  initialized: boolean;
  canEditExecutive: boolean;
};
const mocks = vi.hoisted(() => ({
  data: undefined as PreferenceState | undefined,
  online: true,
  mutate: vi.fn(),
  setData: vi.fn(),
  queryOptions: vi.fn(),
  suppressPoll: false,
}));
// Legacy editor/draft fixtures keep their existing deterministic HTTP result.
// Actual cache certificates/fallback are exercised by the integration suite.
vi.mock("~/hooks/use-material-sort-authority", () => ({
  useMaterialSortAuthority: () => ({
    active: true,
    suppressPoll: mocks.suppressPoll,
    editable: mocks.online && !!mocks.data,
    canEditExecutive: mocks.data?.canEditExecutive ?? false,
  }),
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => mocks.online,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      user: { getMaterialSortPreferences: { setData: mocks.setData } },
    }),
    user: {
      getMaterialSortPreferences: {
        useQuery: (_input: unknown, options: unknown) => {
          mocks.queryOptions(options);
          return {
            data: mocks.data,
            refetch: vi.fn().mockResolvedValue(undefined),
          };
        },
      },
      setMaterialSortPreferences: {
        useMutation: () => ({ mutateAsync: mocks.mutate }),
      },
    },
  },
}));
function Controls() {
  const value = useMaterialSortContext()!;
  return (
    <>
      <output>
        {value.sortMode}:{value.custom ? "personal" : "executive"}
      </output>
      <button onClick={() => value.setCustom(true)}>Customize</button>
      <button onClick={() => value.setCustom(false)}>Follow</button>
      <button onClick={() => value.setSortMode("recent")}>Recent</button>
      <button onClick={() => value.setEditingExecutive(true)}>
        Edit shared
      </button>
      <span>{value.error}</span>
    </>
  );
}
const mount = (id = "crew") =>
  render(
    <MaterialSortProvider userId={id} organizationId="org">
      <Controls />
    </MaterialSortProvider>,
  );
beforeEach(() => {
  vi.useFakeTimers();
  mocks.online = true;
  mocks.suppressPoll = false;
  mocks.data = {
    shared: defaultMaterialSortSettings,
    personal: { ...defaultMaterialSortSettings, sortMode: "supplier" },
    custom: false,
    initialized: true,
    canEditExecutive: false,
  };
  mocks.mutate.mockReset().mockImplementation(async () => mocks.data);
  mocks.setData.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("defaults to executive sorting despite existing personal settings, and requires opt-in before editing", async () => {
  mount();
  expect(screen.getByText("material:executive")).toBeVisible();
  fireEvent.click(screen.getByText("Recent"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Customize"));
  expect(screen.getByText("supplier:personal")).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(mocks.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedUserId: "crew",
      expectedOrganizationId: "org",
      target: "personal",
      custom: true,
    }),
  );
});
it("switches back to live executive settings while preserving the personal choice", async () => {
  mocks.data!.custom = true;
  mount();
  fireEvent.click(screen.getByText("Follow"));
  expect(screen.getByText("material:executive")).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(mocks.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      custom: false,
      settings: expect.objectContaining({ sortMode: "supplier" }) as unknown,
    }),
  );
});
it("editing shared defaults does not replace an executive's opted-in personal sorting", async () => {
  mocks.data!.custom = true;
  mocks.data!.canEditExecutive = true;
  mount();
  fireEvent.click(screen.getByText("Edit shared"));
  fireEvent.click(screen.getByText("Recent"));
  expect(screen.getByText("supplier:personal")).toBeVisible();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(mocks.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      target: "executive",
      settings: expect.objectContaining({ sortMode: "recent" }) as unknown,
    }),
  );
});
it("keeps failed saves visible and does not overwrite the last confirmed offline preference", async () => {
  mocks.mutate.mockRejectedValue(new Error("offline"));
  mount();
  fireEvent.click(screen.getByText("Customize"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(screen.getByText(/Sorting could not be saved/)).toBeVisible();
  expect(
    (
      JSON.parse(
        localStorage.getItem("foremenhq.material-sort.v2.org.crew")!,
      ) as PreferenceState
    ).custom,
  ).toBe(false);
});
it("does not import legacy browser preferences for employees", async () => {
  mocks.data!.initialized = false;
  localStorage.setItem("foremenhq.material-list-sort", "recent");
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(screen.getByText("material:executive")).toBeVisible();
});
it("seeds executive preferences once without overwriting an already published default", async () => {
  mocks.data!.initialized = false;
  mocks.data!.canEditExecutive = true;
  localStorage.setItem("foremenhq.material-list-sort", "recent");
  await act(async () => {
    mount("executive-user");
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      target: "executive",
      initializeOnly: true,
      settings: expect.objectContaining({ sortMode: "recent" }) as unknown,
    }),
  );
});
it("loads only the current account's offline cache", async () => {
  localStorage.setItem(
    "foremenhq.material-sort.v2.org.other",
    JSON.stringify({ ...mocks.data, custom: true }),
  );
  mocks.online = false;
  mocks.data = undefined;
  mount();
  expect(screen.getByText("material:executive")).toBeVisible();
  fireEvent.click(screen.getByText("Customize"));
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("does not replace an executive's existing device settings with defaults from a fresh browser", async () => {
  mocks.data!.initialized = false;
  mocks.data!.canEditExecutive = true;
  await act(async () => {
    mount("executive-user");
  });
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("retains the 60-second authority refresh alongside realtime settings", () => {
  mount();
  expect(mocks.queryOptions).toHaveBeenLastCalledWith({
    enabled: true,
    refetchOnMount: "always",
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });
});

it("only disables the preference interval after the separate verified authority policy opts in", () => {
  mocks.suppressPoll = true;
  mount();
  expect(mocks.queryOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ refetchInterval: false }),
  );
});
