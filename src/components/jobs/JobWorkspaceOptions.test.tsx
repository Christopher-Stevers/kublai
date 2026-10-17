import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobWorkspaceOptions } from "./JobWorkspaceOptions";
afterEach(cleanup);
it("orders the job cards and opens Chat with keyboard or touch", () => {
  const select = vi.fn();
  render(<JobWorkspaceOptions onSelect={select} chatUnreadCount={7} />);
  const rooms = screen.getByText("Rooms");
  const chat = screen.getByRole("button", { name: "Chat, 7 unread messages" });
  expect(screen.getAllByRole("button").map(button =>
    button.querySelector('[data-slot="card-title"]')?.textContent?.replace(/Experimental|7/g, "").trim(),
  )).toEqual(["Material Lists", "Drawings", "Chat", "Documents", "Rooms", "Models"]);
  fireEvent.keyDown(chat, { key: "Enter" });
  fireEvent.click(chat);
  expect(select).toHaveBeenNthCalledWith(1, "chat");
  expect(select).toHaveBeenNthCalledWith(2, "chat");
  expect(rooms.closest('[role="button"]')).toHaveTextContent(
    "Experimental",
  );
  expect(
    screen.getByRole("button", { name: "Models, experimental" }),
  ).toHaveTextContent("Experimental");
});

it.each([
  [0, "0 rooms"],
  [1, "1 room"],
  [12, "12 rooms"],
] as const)("shows the supplied saved-room count %s", (roomCount, text) => {
  render(<JobWorkspaceOptions onSelect={vi.fn()} roomCount={roomCount} />);
  expect(screen.getByText(text)).toBeInTheDocument();
});
it("shows loading instead of a false zero", () => {
  render(<JobWorkspaceOptions onSelect={vi.fn()} roomCountLoading />);
  expect(screen.getByText("Loading rooms…")).toBeInTheDocument();
  expect(screen.queryByText("0 rooms")).not.toBeInTheDocument();
});
it("shows unavailable instead of a false zero without cached rooms", () => {
  render(<JobWorkspaceOptions onSelect={vi.fn()} />);
  expect(screen.getByText("Room count unavailable")).toBeInTheDocument();
  expect(screen.queryByText("0 rooms")).not.toBeInTheDocument();
});
