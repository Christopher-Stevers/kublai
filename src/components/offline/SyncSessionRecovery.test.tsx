import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getDefaultPuller, getDefaultPusher } from "replicache";
import { SyncSessionRecovery } from "./SyncSessionRecovery";
import { MaterialListSyncIndicator } from "~/components/materialLists/MaterialListSyncIndicator";
import { attachSyncSession } from "~/lib/sync-session";
const state = vi.hoisted(() => ({
  clerk: { session: null as null | { id: string; user: { id: string }; getToken: ReturnType<typeof vi.fn> }, redirectToSignIn: vi.fn() },
}));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => state.clerk, useSession: () => ({ isLoaded: true, session: state.clerk.session }) }));
let detach: (() => void) | undefined;
afterEach(() => { cleanup(); detach?.(); detach = undefined; vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup() {
  state.clerk.session = { id: "session-a", user: { id: "user-a" }, getToken: vi.fn(async (): Promise<string | null> => null) };
  render(<><SyncSessionRecovery /><MaterialListSyncIndicator status="synced" /></>);
  const rep = {
    auth: "", pullURL: "https://example.test/pull", pushURL: "https://example.test/push",
    puller: getDefaultPuller({ pullURL: "https://example.test/pull", auth: "" }),
    pusher: getDefaultPusher({ pushURL: "https://example.test/push", auth: "" }),
    pull: vi.fn(async () => { await rep.puller({ pullVersion: 1, profileID: "p", clientGroupID: "g", schemaVersion: "1", cookie: null }, "id"); }),
    push: vi.fn(async () => undefined),
  };
  detach = attachSyncSession(rep);
  return rep;
}
it("shows a clear sign-in action instead of a green synced badge, then resumes without reloading", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 401 })));
  const rep = setup();
  await act(() => rep.pull());
  expect(state.clerk.session!.getToken).toHaveBeenCalledWith({ skipCache: true });
  expect(screen.queryByLabelText("Synced")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Sign in again to sync")).toBeInTheDocument();
  expect(screen.getByText("Unsynced material changes stay on this device.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(state.clerk.redirectToSignIn).toHaveBeenCalledWith({ redirectUrl: window.location.href });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cookie: null, lastMutationIDChanges: {}, patch: [] })));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByLabelText("Synced")).toBeInTheDocument());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(rep.push).toHaveBeenCalledOnce();
});
it("recovers connection failures when the browser reconnects without asking for sign-in", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
  const rep = setup(); await act(async () => { await rep.pull().catch(() => undefined); });
  expect(screen.getByText("Sync couldn’t finish")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cookie: null, lastMutationIDChanges: {}, patch: [] })));
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(screen.getByLabelText("Synced")).toBeInTheDocument());
});
