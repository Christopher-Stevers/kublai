import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useHiddenPartsMutations } from "./use-hidden-parts-mutations";
import type { CatalogueHideRule } from "~/lib/catalogue-hidden";

const state = vi.hoisted(() => ({ hide: vi.fn(), show: vi.fn(), invalidate: vi.fn(), notify: vi.fn() }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: state.notify }));
vi.mock("@trpc/react-query", () => ({ getQueryKey: () => ["hidden-parts"] }));
vi.mock("~/trpc/react", () => ({ api: {
  catalogue: { getHiddenParts: {} },
  useUtils: () => ({
    client: { catalogue: { hideParts: { mutate: state.hide }, showHiddenParts: { mutate: state.show } } },
    catalogue: { getHiddenParts: { invalidate: state.invalidate } },
  }),
} }));
afterEach(() => vi.clearAllMocks());
const setup = (rules: CatalogueHideRule[] = []) => {
  const client = new QueryClient();
  client.setQueryData(["hidden-parts"], { rules });
  const onHidden = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useHiddenPartsMutations(onHidden), { wrapper });
  return { ...hook, client, onHidden, rules: () => client.getQueryData<{ rules: CatalogueHideRule[] }>(["hidden-parts"])!.rules };
};

describe("immediate catalogue visibility", () => {
  it("hides from the cache immediately and replaces temporary ids with the server result", async () => {
    let resolve!: (value: { rules: CatalogueHideRule[] }) => void;
    state.hide.mockReturnValue(new Promise(yes => { resolve = yes; }));
    const view = setup();
    act(() => {
      view.result.current.hide.mutate({ criteria: { partId: "fixture" } });
      expect(view.rules()).toHaveLength(1);
      expect(view.rules()[0]?.partId).toBe("fixture");
      expect(typeof view.rules()[0]?.id).toBe("string");
    });
    await waitFor(() => expect(state.hide).toHaveBeenCalledOnce());
    expect(view.onHidden).not.toHaveBeenCalled();
    await act(async () => resolve({ rules: [{ id: "server", partId: "fixture" }] }));
    expect(view.rules()).toEqual([{ id: "server", partId: "fixture" }]);
    expect(view.onHidden).toHaveBeenCalledOnce();
  });

  it("restores hidden siblings on a rejected unhide and does not invent success", async () => {
    state.show.mockRejectedValue(new Error("permission changed"));
    const original = [{ id: "rule", catalogId: "catalog" }];
    const view = setup(original);
    act(() => {
      view.result.current.show.mutate({ criteria: [{ partId: "child" }] });
      expect(view.rules()[0]?.exceptions).toEqual([{ partId: "child" }]);
    });
    await waitFor(() => expect(view.result.current.show.isError).toBe(true));
    expect(view.rules()).toEqual(original);
    expect(state.notify).toHaveBeenCalledOnce();
    expect(view.onHidden).not.toHaveBeenCalled();
  });

  it("does not send an unhide for a temporary rule while a hide is still pending", async () => {
    let resolve!: (value: { rules: CatalogueHideRule[] }) => void;
    state.hide.mockReturnValue(new Promise(yes => { resolve = yes; }));
    const view = setup();
    act(() => view.result.current.hide.mutate({ criteria: { partId: "fixture" } }));
    const id = view.rules()[0]!.id;
    act(() => view.result.current.show.mutate({ ruleId: id }));
    await waitFor(() => expect(view.result.current.show.isError).toBe(true));
    expect(state.show).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    await act(async () => resolve({ rules: [{ id: "server", partId: "fixture" }] }));
    expect(view.rules()[0]?.id).toBe("server");
  });
});
