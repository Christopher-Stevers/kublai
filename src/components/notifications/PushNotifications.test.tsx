import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  identity: {
    data: {
      userId: "user-a",
      account: "a".repeat(64),
      eligible: true,
      publicKey: "AQID",
    } as {
      userId: string | null;
      account: string | null;
      eligible: boolean;
      publicKey: string | null;
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  subscribe: vi.fn(),
  device: vi.fn(),
  freshIdentity: vi.fn(),
  getSubscription: vi.fn(),
  browserSubscribe: vi.fn(),
  unsubscribe: vi.fn(),
  getRegistration: vi.fn(),
  register: vi.fn(),
  permission: vi.fn(),
  fetch: vi.fn(),
  postMessage: vi.fn(),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
const utils = {
  push: {
    device: { fetch: mocks.device },
    identity: { fetch: mocks.freshIdentity },
  },
};
vi.mock("~/trpc/react", () => ({
  api: {
    push: {
      identity: { useQuery: () => mocks.identity },
      subscribe: { useMutation: () => ({ mutateAsync: mocks.subscribe }) },
    },
    useUtils: () => utils,
  },
}));
import {
  PushNotifications,
  PushAccountBinding,
  disconnectPushDevice,
} from "./PushNotifications";

const storageKey = "foremanhq-chat-push-device-v1";
const stored = {
  userId: "user-a",
  account: "a".repeat(64),
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  revokeToken: "r".repeat(43),
};
const browserSubscription = {
  endpoint: stored.endpoint,
  unsubscribe: mocks.unsubscribe,
  toJSON: () => ({
    endpoint: stored.endpoint,
    keys: { p256dh: "test-key", auth: "test-auth" },
  }),
};
const reg = {
  active: { postMessage: mocks.postMessage },
  pushManager: {
    getSubscription: mocks.getSubscription,
    subscribe: mocks.browserSubscribe,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  mocks.identity.refetch.mockImplementation(async () => ({
    data: mocks.identity.data,
  }));
  mocks.freshIdentity.mockImplementation(async () => mocks.identity.data);
  mocks.identity.data = {
    userId: "user-a",
    account: "a".repeat(64),
    eligible: true,
    publicKey: "AQID",
  };
  mocks.identity.isError = false;
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  vi.stubGlobal("PushManager", class PushManager {});
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: mocks.permission,
  });
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        close: vi.fn(),
        onmessage: null as ((event: { data: { ok: boolean } }) => void) | null,
      };
      port2 = {
        callback: () => this.port1.onmessage?.({ data: { ok: true } }),
      };
    },
  );
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      getRegistration: mocks.getRegistration,
      register: mocks.register,
      ready: Promise.resolve(reg),
      controller: null,
    },
    configurable: true,
  });
  mocks.getRegistration.mockResolvedValue(reg);
  mocks.getSubscription.mockResolvedValue(null);
  mocks.browserSubscribe.mockImplementation(async () => {
    mocks.getSubscription.mockResolvedValue(browserSubscription);
    return browserSubscription;
  });
  mocks.permission.mockImplementation(async () => {
    Object.defineProperty(Notification, "permission", {
      value: "granted",
      configurable: true,
    });
    return "granted";
  });
  mocks.subscribe.mockResolvedValue(stored);
  mocks.unsubscribe.mockResolvedValue(true);
  mocks.device.mockResolvedValue({ subscribed: true });
  mocks.postMessage.mockImplementation(
    (_message: unknown, ports: [{ callback: () => void }]) =>
      ports[0].callback(),
  );
  mocks.fetch.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("device notification opt-in", () => {
  it("never prompts on mount; only an explicit click requests permission and saves a device", async () => {
    render(<PushNotifications />);
    const button = await screen.findByRole("button", {
      name: "Turn push notifications on",
    });
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Turn push notifications off" });
    expect(mocks.permission).toHaveBeenCalledOnce();
    expect(mocks.browserSubscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array) as unknown,
    });
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject(stored);
  });
  it("recognizes an existing device opt-in and turns it off without requesting permission again", async () => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
    mocks.getSubscription.mockResolvedValue(browserSubscription);
    Object.defineProperty(Notification, "permission", {
      value: "granted",
      configurable: true,
    });
    render(<PushNotifications />);
    const off = await screen.findByRole("button", {
      name: "Turn push notifications off",
    });
    await waitFor(() => expect(off).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("On for this device");
    fireEvent.click(off);
    await screen.findByRole("button", { name: "Turn push notifications on" });
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/trpc/push.revokeDevice",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  it("disables the button for unconfigured, unsupported and denied states with clear explanations", async () => {
    mocks.identity.data = { ...mocks.identity.data, publicKey: null };
    const view = render(<PushNotifications />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Turn push notifications on" }),
      ).toBeDisabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("aren’t configured"),
    );
    view.unmount();
    mocks.identity.data = { ...mocks.identity.data, publicKey: "AQID" };
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    const unsupported = render(<PushNotifications />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Turn push notifications on" }),
      ).toBeDisabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("aren’t supported"),
    );
    unsupported.unmount();
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(Notification, "permission", {
      value: "denied",
      configurable: true,
    });
    const denied = render(<PushNotifications />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Turn push notifications on" }),
      ).toBeDisabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("blocked"),
    );
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it("server refusal rolls back a newly created browser subscription and surfaces the error", async () => {
    mocks.subscribe.mockRejectedValue(new Error("Connection interrupted"));
    render(<PushNotifications />);
    const enable = await screen.findByRole("button", {
      name: "Turn push notifications on",
    });
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(enable);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection interrupted",
    );
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it("a switched account revokes the old opt-in instead of assigning it to the new account", async () => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
    mocks.getSubscription.mockResolvedValue(browserSubscription);
    mocks.identity.data = {
      ...mocks.identity.data,
      userId: "user-b",
      account: "b".repeat(64),
    };
    render(<PushAccountBinding />);
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/trpc/push.revokeDevice",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.postMessage).toHaveBeenCalledWith(
      { type: "FOREMANHQ_PUSH_ACCOUNT", account: null },
      expect.any(Array),
    );
  });
  it("logout clears local account binding even offline and retains a revoke token for retry", async () => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
    mocks.getSubscription.mockResolvedValue(browserSubscription);
    mocks.fetch.mockRejectedValue(new Error("offline"));
    await expect(disconnectPushDevice()).rejects.toThrow("offline");
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
      ...stored,
      revoked: true,
    });
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(mocks.postMessage).toHaveBeenCalledWith(
      { type: "FOREMANHQ_PUSH_ACCOUNT", account: null },
      expect.any(Array),
    );
  });
  it("logout with no subscription does not register a worker or make a revoke request", async () => {
    mocks.getRegistration.mockResolvedValue(undefined);
    await act(async () => disconnectPushDevice());
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("repeated revoked state does not storm the server while offline", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...stored, revoked: true }),
    );
    mocks.fetch.mockRejectedValue(new Error("offline"));
    render(<PushAccountBinding />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("revalidates a stale tab identity before revoking another account's new opt-in", async () => {
    const replacement = {
      ...stored,
      userId: "user-b",
      account: "b".repeat(64),
      revokeToken: "s".repeat(43),
    };
    localStorage.setItem(storageKey, JSON.stringify(replacement));
    mocks.identity.refetch.mockResolvedValue({
      data: {
        ...mocks.identity.data,
        userId: "user-b",
        account: replacement.account,
      },
    });
    render(<PushAccountBinding />);
    await waitFor(() =>
      expect(mocks.postMessage).toHaveBeenCalledWith(
        { type: "FOREMANHQ_PUSH_ACCOUNT", account: replacement.account },
        expect.any(Array),
      ),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(readStored()).toMatchObject(replacement);
  });
  it("a late revoke completion does not erase a replacement device", async () => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
    let finish!: (value: { ok: boolean }) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = disconnectPushDevice();
    const replacement = {
      ...stored,
      revokeToken: "s".repeat(43),
      userId: "user-b",
    };
    localStorage.setItem(storageKey, JSON.stringify(replacement));
    finish({ ok: true });
    await pending;
    expect(readStored()).toMatchObject(replacement);
  });
  it("logout during enrollment rejects its late response and revokes that returned capability", async () => {
    let finish!: (value: typeof stored) => void;
    mocks.subscribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<PushNotifications />);
    const enable = await screen.findByRole("button", {
      name: "Turn push notifications on",
    });
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(enable);
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    await act(async () => {
      await disconnectPushDevice();
      finish(stored);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("cancelled");
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/trpc/push.revokeDevice",
      expect.objectContaining({
        body: JSON.stringify({
          json: { endpoint: stored.endpoint, revokeToken: stored.revokeToken },
        }),
      }),
    );
    expect(
      mocks.postMessage.mock.calls.some(
        ([message]) =>
          (message as { account: string | null }).account === stored.account,
      ),
    ).toBe(false);
  });
});

function readStored(): unknown {
  return JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
}
