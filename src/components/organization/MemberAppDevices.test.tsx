import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, it, expect } from "vitest";
import { MemberAppDevices } from "./MemberAppDevices";
import type { AppDeviceObservation } from "~/lib/app-devices";
afterEach(cleanup);
const device: AppDeviceObservation = {
  deviceId: "profile",
  userId: "member",
  deviceType: "phone",
  platform: "Android",
  mode: "browser",
  installButtonVisible: true,
  lastSeenAt: "2026-10-10T12:00:00Z",
  installedAppLastSeenAt: null,
};
it("shows unknown rather than claiming an unseen member is uninstalled", () => {
  render(<MemberAppDevices devices={[]} loading={false} unavailable={false} />);
  expect(screen.getByText("Unknown · no device report yet")).toBeTruthy();
  expect(
    screen.getByText(
      "No device report yet. Ask them to open ForemanHQ while online.",
    ),
  ).toBeTruthy();
});
it("shows browser use, button visibility and last check without claiming installation", () => {
  render(
    <MemberAppDevices devices={[device]} loading={false} unavailable={false} />,
  );
  expect(screen.getByText("Browser last seen")).toBeTruthy();
  expect(screen.getByText("Install button shown on last check")).toBeTruthy();
  expect(screen.getByText(/Last checked:/)).toBeTruthy();
  expect(screen.queryByText("Installed app detected")).toBeNull();
});
it("keeps historical installed evidence separate from the latest browser visit", () => {
  render(
    <MemberAppDevices
      devices={[{ ...device, installedAppLastSeenAt: "2026-10-09T12:00:00Z" }]}
      loading={false}
      unavailable={false}
    />,
  );
  expect(screen.getByText("Installed app detected")).toBeTruthy();
  expect(screen.getByText("Last opened in browser")).toBeTruthy();
  expect(screen.getByText(/Installed app last detected:/)).toBeTruthy();
});
