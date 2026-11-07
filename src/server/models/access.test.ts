// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import {
  checkModelAccess,
  requireModelUpload,
  type ModelAccess,
} from "./access";
import { assertIssueEdit } from "./service";
import { toStoredConfig } from "~/server/auth/permissions";
import type { RequestUser } from "~/server/utils/get-request-identity";
import type { BimIssue } from "~/lib/bim/types";
const organizationId = "00000000-0000-4000-8000-000000000001";
const job = {
  id: organizationId,
  organizationId,
  name: "Test",
  createdByUserId: null,
  foremanUserId: null,
};
const user = {
  id: "a",
  name: "A",
  email: "a@example.invalid",
  role: "user",
  organizationId,
  organizationAccessStatus: "approved",
  permissionConfig: toStoredConfig({
    "tab.dashboard": true,
    "drawings.view": true,
    "drawings.upload": false,
  }),
} as RequestUser;
describe("model permissions", () => {
  it("requires authentication, approval, drawing access and the same organization", () => {
    expect(() => checkModelAccess(null, job)).toThrow();
    expect(() =>
      checkModelAccess({ ...user, organizationAccessStatus: "pending" }, job),
    ).toThrow();
    expect(() =>
      checkModelAccess(user, { ...job, organizationId: crypto.randomUUID() }),
    ).toThrow();
    expect(() =>
      checkModelAccess(
        {
          ...user,
          permissionConfig: toStoredConfig({
            "tab.dashboard": true,
            "drawings.view": false,
            "drawings.upload": true,
          }),
        },
        job,
      ),
    ).toThrow();
    expect(() => requireModelUpload(checkModelAccess(user, job))).toThrow();
  });
  it("restricts assignees to status changes without trusting field order", () => {
    const old = {
      id: organizationId,
      revision: 1,
      authorId: "other",
      authorName: "Other",
      createdAt: "now",
      updatedAt: "now",
      comments: [],
      assigneeId: "a",
      title: "Wall",
      status: "open",
      description: "Check",
      kind: "coordination",
      priority: "normal",
      dueDate: null,
      point: [0, 0, 0],
      element: null,
      view: {},
    } as unknown as BimIssue;
    const {
      id,
      revision,
      authorId,
      authorName,
      createdAt,
      updatedAt,
      comments,
      ...data
    } = old;
    const access = { user, canUpload: false } as ModelAccess;
    expect(() =>
      assertIssueEdit(access, old, { ...data, status: "resolved" }),
    ).not.toThrow();
    expect(() =>
      assertIssueEdit(access, old, {
        ...data,
        status: "resolved",
        title: "Changed",
      }),
    ).toThrow();
    expect(() =>
      assertIssueEdit(
        { ...access, user: { ...user, id: "outsider" } },
        old,
        data,
      ),
    ).toThrow();
  });
});
