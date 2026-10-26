import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  path: "/jobs/chat",
  chat: false,
  dashboard: true,
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/trpc/react", () => ({
  api: {
    user: {
      getMyRole: {
        useQuery: () => ({
          data: {
            permissions: {
              tabAccess: { chat: state.chat, dashboard: state.dashboard },
            },
          },
        }),
      },
    },
  },
}));
import { TabAccessGate } from "./TabAccessGate";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.chat = false;
  state.dashboard = true;
});
it("blocks the main Chat page but leaves a job's Chat page available", () => {
  state.path = "/jobs/chat";
  render(<TabAccessGate />);
  expect(state.replace).toHaveBeenCalledWith("/jobs");
  cleanup();
  state.replace.mockClear();
  state.path = "/jobs/00000000-0000-4000-8000-000000000001/chat";
  render(<TabAccessGate />);
  expect(state.replace).not.toHaveBeenCalled();
});
it("allows the main Chat page without granting Jobs access", () => {
  state.path = "/jobs/chat";
  state.chat = true;
  state.dashboard = false;
  render(<TabAccessGate />);
  expect(state.replace).not.toHaveBeenCalled();
});
