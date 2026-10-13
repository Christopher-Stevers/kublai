import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemberNotifications } from "./MemberNotifications";
import {
  pushDeviceType,
  type MemberNotificationStatus,
} from "~/lib/member-notifications";
const ready: MemberNotificationStatus = {
  state: "ready",
  devices: 2,
  phones: 1,
  computers: 1,
  tablets: 0,
  unknownDevices: 0,
  mutedJobs: 2,
  pending: 0,
  failed: 0,
  lastSentAt: null,
};
afterEach(cleanup);
describe("member notification status", () => {
  it("shows phone opt-in without claiming display or a read receipt", () => {
    render(<MemberNotifications status={ready} />);
    expect(screen.getByText("Phone push enabled")).toBeInTheDocument();
    expect(screen.getByText("1 phone registered")).toBeInTheDocument();
    expect(screen.getByText("2 muted job chats")).toBeInTheDocument();
    expect(
      screen.getByText(/do not confirm that an alert appeared or was read/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("None recorded in the last 7 days"),
    ).toBeInTheDocument();
  });
  it("does not interpret an older unidentified device as a phone", () => {
    render(
      <MemberNotifications
        status={{
          ...ready,
          devices: 1,
          phones: 0,
          computers: 0,
          unknownDevices: 1,
        }}
      />,
    );
    expect(screen.getByText("Phone status unknown")).toBeInTheDocument();
    expect(screen.queryByText("Phone push enabled")).not.toBeInTheDocument();
  });
  it("shows a blocked member's registered devices as paused", () => {
    render(
      <MemberNotifications status={{ ...ready, state: "access-blocked" }} />,
    );
    expect(screen.getByText("Push paused · access")).toBeInTheDocument();
    expect(screen.queryByText("Phone push enabled")).not.toBeInTheDocument();
  });
  it("hides notification details when access is not granted", () => {
    render(<MemberNotifications status={null} />);
    expect(
      screen.queryByRole("region", { name: "Push notification status" }),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["Mozilla Android Mobile", 0, "phone"],
    ["Mozilla Android", 0, "tablet"],
    ["Mozilla iPhone", 0, "phone"],
    ["Mozilla Macintosh", 5, "tablet"],
    ["Mozilla Windows", 0, "computer"],
    ["unidentified", 0, "unknown"],
  ])("classifies %s with %s touch points as %s", (ua, points, type) => {
    expect(pushDeviceType(String(ua), Number(points))).toBe(type);
  });
});
