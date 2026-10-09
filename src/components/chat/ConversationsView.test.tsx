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
  deleted: false,
  source: null as null | { href: string; title: string; capturedAt: string },
  own: false,
  image: false,
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
                author: {
                  id: mocks.own ? "sender" : "recipient",
                  name: "Recipient",
                },
                body: "Private review",
                attachments: mocks.image
                  ? [
                      {
                        id: "image",
                        mimeType: "image/png",
                        name: "snapshot.png",
                        url: "/image",
                      },
                    ]
                  : [],
                source: mocks.source,
                createdAt: new Date(),
                deletedAt: mocks.deleted ? new Date() : null,
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
vi.mock("~/components/jobs/ChatNotifications", () => ({
  ChatNotifications: () => <button>Enable device notifications</button>,
}));
import { ConversationsView } from "./ConversationsView";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.denied = false;
  mocks.deleted = false;
  mocks.source = null;
  mocks.own = false;
  mocks.image = false;
  mocks.send.mockResolvedValue({ id: "sent" });
  mocks.read.mockResolvedValue(undefined);
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("offers editing only for an author's undeleted image snapshots and preserves the saved view", () => {
  mocks.own = true;
  mocks.image = true;
  mocks.source = {
    href: "/dashboard/jobs/job/drawings?drawingSheet=sheet#snapshot=recorded",
    title: "Drawing",
    capturedAt: "2026-10-09T22:00:00Z",
  };
  const view = render(<ConversationsView />);
  const href = screen
    .getByRole("link", { name: "Edit snapshot" })
    .getAttribute("href")!;
  const url = new URL(href, "https://app.invalid");
  expect(url.hash).toBe("#snapshot=recorded");
  expect(url.searchParams.get("editSnapshot")).toBe("message");
  expect(url.searchParams.get("snapshotChat")).toBe("room");
  mocks.own = false;
  view.rerender(<ConversationsView />);
  expect(
    screen.queryByRole("link", { name: "Edit snapshot" }),
  ).not.toBeInTheDocument();
  mocks.own = true;
  mocks.deleted = true;
  view.rerender(<ConversationsView />);
  expect(
    screen.queryByRole("link", { name: "Edit snapshot" }),
  ).not.toBeInTheDocument();
});
it("opens a snapshot's recorded local view and hides the link when the message is deleted", () => {
  mocks.source = {
    href: "/dashboard/jobs/test/drawings#snapshot=recorded-view",
    title: "Mechanical drawing",
    capturedAt: "2026-10-09T18:00:00Z",
  };
  const view = render(<ConversationsView />);
  expect(
    screen.getByRole("link", { name: "Open snapshot source" }),
  ).toHaveAttribute("href", mocks.source.href);
  mocks.deleted = true;
  view.rerender(<ConversationsView />);
  expect(
    screen.queryByRole("link", { name: "Open snapshot source" }),
  ).not.toBeInTheDocument();
});
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

it("offers device notification setup inside person and group chats", () => {
  render(<ConversationsView />);
  expect(
    screen.getByRole("button", { name: "Enable device notifications" }),
  ).toBeVisible();
});
