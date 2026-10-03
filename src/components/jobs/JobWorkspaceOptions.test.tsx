import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobWorkspaceOptions } from "./JobWorkspaceOptions";
afterEach(cleanup);
it("puts Chat after Rooms and opens it with keyboard or touch", () => {
  const select = vi.fn();
  render(<JobWorkspaceOptions onSelect={select} chatUnreadCount={7} />);
  const rooms = screen.getByText("Rooms");
  const chat = screen.getByRole("button", { name: "Chat, 7 unread messages" });
  expect(
    rooms.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.keyDown(chat, { key: "Enter" });
  fireEvent.click(chat);
  expect(select).toHaveBeenNthCalledWith(1, "chat");
  expect(select).toHaveBeenNthCalledWith(2, "chat");
  expect(screen.getByText("Experimental")).toBeInTheDocument();
});
