import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ jobs: true, chat: false }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
}));
vi.mock("~/server/utils/get-request-identity", () => ({
  getRequestIdentity: async () => ({
    user: {
      role: "user",
      permissionConfig: {
        version: 2,
        permissions: { "tab.dashboard": state.jobs, "tab.chat": state.chat },
      },
    },
  }),
}));
vi.mock("~/components/chat/ConversationsView", () => ({
  ConversationsView: () => null,
}));
import ChatPage from "./page";
it("denies direct Chat page requests when Chat is off", async () => {
  state.chat = false;
  state.jobs = true;
  await expect(ChatPage()).rejects.toThrow("redirect:/jobs");
  state.jobs = false;
  await expect(ChatPage()).rejects.toThrow("redirect:/jobs/account");
});
it("renders the Chat page when granted independently of Jobs", async () => {
  state.chat = true;
  state.jobs = false;
  await expect(ChatPage()).resolves.toBeTruthy();
});
