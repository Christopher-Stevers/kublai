import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  denied: false,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("conversation=room"),
}));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      conversations: {
        list: { invalidate: mocks.invalidate },
        history: { invalidate: mocks.invalidate },
      },
    }),
    conversations: {
      list: {
        useQuery: () => ({
          data: {
            userId: "sender",
            conversations: [
              {
                id: "room",
                name: "Review group",
                kind: "group",
                unreadCount: 0,
                members: [
                  { id: "sender", name: "Sender" },
                  { id: "recipient", name: "Recipient" },
                ],
              },
            ],
          },
        }),
      },
      create: { useMutation: () => ({}) },
      history: {
        useQuery: () => ({
          data: {
            messages: [
              {
                id: "message",
                sequence: 1,
                author: { id: "recipient", name: "Recipient" },
                body: "Private review",
                attachments: [],
                createdAt: new Date(),
                deletedAt: null,
              },
            ],
            nextBeforeSequence: null,
          },
          error: mocks.denied ? { data: { code: "FORBIDDEN" } } : null,
        }),
      },
      send: { useMutation: () => ({ mutateAsync: mocks.send }) },
      remove: { useMutation: () => ({ mutateAsync: mocks.remove }) },
      markRead: { useMutation: () => ({ mutateAsync: mocks.read }) },
    },
  },
}));
import { ConversationsView } from "./ConversationsView";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.denied = false;
  mocks.send.mockResolvedValue({ id: "sent" });
  mocks.read.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("keeps an uncertain message immutable and reuses its client identity on retry", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(<ConversationsView />);
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Check this run" },
  });
  fireEvent.click(screen.getByLabelText("Send message"));
  await screen.findByText("Connection interrupted");
  expect(screen.getByLabelText("Message")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Retry message"));
  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1]);
});
it("hides cached private messages and disables sending after access is revoked", () => {
  mocks.denied = true;
  render(<ConversationsView />);
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  expect(
    screen.getByText("This conversation is unavailable."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toBeDisabled();
});
