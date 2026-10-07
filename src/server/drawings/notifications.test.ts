// @vitest-environment node
import { describe, expect, it } from "vitest";
import { drawingSaveSchema } from "~/lib/drawing-workspace";
import { prepareEntity } from "./domain";
import {
  drawingNotificationReason,
  drawingPushPayload,
  eligibleDrawingRecipient,
} from "./notification-policy";
const id = "11111111-1111-4111-8111-111111111111";
const actor = {
  id: "author",
  name: "Author",
  organizationId: "org",
  canManage: true,
};
const sheets = [
  {
    id,
    sheetId: id,
    name: "Private sheet title",
    imageUrl: "/sheet.png",
    width: 100,
    height: 100,
    setId: id,
    sourceFilename: null,
  },
];
const issue = prepareEntity(
  drawingSaveSchema.parse({
    id,
    sheetId: id,
    kind: "issue",
    visibility: "published",
    expectedRevision: 0,
    data: {
      sourceSheetId: id,
      type: "rfi",
      title: "Confidential issue",
      point: { x: 0, y: 0 },
      assigneeId: "assigned",
    },
  }),
  null,
  actor,
  sheets,
  ["assigned"],
  "2026-10-07T00:00:00Z",
);
const user = {
  id: "assigned",
  organizationId: "org",
  organizationAccessStatus: "approved",
  role: "worker",
};
const candidate = {
  user,
  organizationId: "org",
  senderId: "author",
  entity: issue,
  watching: false,
};
describe("drawing notification privacy", () => {
  it("notifies only current assignees or explicit watchers, never the sender", () => {
    expect(eligibleDrawingRecipient(candidate)).toBe(true);
    expect(drawingNotificationReason(issue, "assigned", true)).toBe(
      "assignment",
    );
    expect(
      eligibleDrawingRecipient({
        ...candidate,
        user: { ...user, id: "other" },
      }),
    ).toBe(false);
    expect(
      eligibleDrawingRecipient({
        ...candidate,
        user: { ...user, id: "other" },
        watching: true,
      }),
    ).toBe(true);
    expect(
      eligibleDrawingRecipient({
        ...candidate,
        senderId: "assigned",
        watching: true,
      }),
    ).toBe(false);
  });
  it("rechecks organization, approval, permissions, binding, read and decided status", () => {
    for (const denied of [
      { ...candidate, user: { ...user, organizationId: "elsewhere" } },
      { ...candidate, user: { ...user, organizationAccessStatus: "pending" } },
      {
        ...candidate,
        user: {
          ...user,
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        },
      },
      { ...candidate, subscriptionUserId: "different" },
      { ...candidate, readAt: new Date() },
      { ...candidate, reviewDecided: true },
      { ...candidate, entity: { ...issue, visibility: "private" as const } },
      { ...candidate, entity: { ...issue, visibility: "archived" as const } },
    ])
      expect(eligibleDrawingRecipient(denied)).toBe(false);
  });
  it("does not expose sheet titles, names or issue bodies on a lock screen", () => {
    const payload = JSON.parse(drawingPushPayload(id, id, id, "assigned")) as {
      type: string;
      account: string;
      url: string;
    };
    expect(payload.type).toBe("job-drawing");
    expect(payload.account).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.url).toBe(
      `/dashboard/jobs/${id}/drawings?drawingSet=${id}&drawingSheet=${id}`,
    );
    expect(JSON.stringify(payload)).not.toContain("Confidential");
    expect(JSON.stringify(payload)).not.toContain("assigned");
  });
});
