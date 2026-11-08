import { DevFeaturesProvider } from "~/components/app/DevFeaturesProvider";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render as renderUI, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { JobWorkspaceOptions } from "./JobWorkspaceOptions";
import { DevSettings } from "~/components/account/DevSettings";
import { getLastJobWorkspaceLocation, setLastJobWorkspaceLocation } from "~/lib/job-workspace-last-option";
afterEach(() => { cleanup(); localStorage.clear(); });
it("orders the job cards and opens Chat with keyboard or touch", () => {
  const select = vi.fn();
  render(<JobWorkspaceOptions onSelect={select} chatUnreadCount={7} />);
  const rooms = screen.getByText("Rooms");
  const chat = screen.getByRole("button", { name: "Chat, 7 unread messages" });
  expect(screen.getAllByRole("button").map(button =>
    button.querySelector('[data-slot="card-title"]')?.textContent?.replace(/Dev|7/g, "").trim(),
  )).toEqual(["Material Lists", "Drawings", "Chat", "Documents", "Rooms", "Models", "Systems"]);
  fireEvent.keyDown(chat, { key: "Enter" });
  fireEvent.click(chat);
  expect(select).toHaveBeenNthCalledWith(1, "chat");
  expect(select).toHaveBeenNthCalledWith(2, "chat");
  expect(screen.getByRole("button", { name: /^Rooms$/ })).toBeInTheDocument();
  expect(rooms.closest('[role="button"]')).not.toHaveTextContent("Dev");
  expect(
    screen.getByRole("button", { name: "Models, Dev" }),
  ).toHaveTextContent("Dev");
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

vi.mock("~/components/permissions/SystemsAccess", () => ({ useSystemsAccess: () => true }));

it("hides experimental cards and saved experimental screens once turned off in settings", () => {
  setLastJobWorkspaceLocation({ jobId: "job", view: "models", materialListId: null });
  render(<><DevSettings /><JobWorkspaceOptions onSelect={vi.fn()} /></>);
  expect(screen.getByRole("button", { name: "Models, Dev" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Show Dev features" }));
  expect(screen.queryByRole("button", { name: "Models, Dev" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Systems" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Drawings/ })).toBeInTheDocument();
  expect(getLastJobWorkspaceLocation()?.view).toBe("options");
  fireEvent.click(screen.getByRole("switch", { name: "Show Dev features" }));
  expect(screen.getByRole("button", { name: "Systems" })).toBeInTheDocument();
});

function render(children: ReactNode) {
  return renderUI(<DevFeaturesProvider enabled>{children}</DevFeaturesProvider>);
}
it("hides Models and Voice when deployment dev features are off, even with experimental settings on", () => {
  renderUI(<DevFeaturesProvider enabled={false}><JobWorkspaceOptions onSelect={vi.fn()} /></DevFeaturesProvider>);
  expect(screen.queryByRole("button", { name: "Models, Dev" })).not.toBeInTheDocument();
  expect(screen.queryByText("Voice")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Drawings/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Systems" })).not.toBeInTheDocument();
});

vi.mock("~/components/voice/VoiceProvider", () => ({ VoiceCard: () => <span>Voice</span> }));
