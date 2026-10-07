// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import { checkDocumentAccess } from "./access";
import type { RequestUser } from "~/server/utils/get-request-identity";
import type { ChatJob } from "~/server/chat/access";

const user = {
  id: "user",
  organizationId: "org",
  role: "worker",
  organizationAccessStatus: "approved",
  permissionConfig: {
    version: 2,
    permissions: { "tab.dashboard": true, "documents.manage": true },
  },
} as RequestUser;
const job = { id: "job", organizationId: "org" } as ChatJob;
describe("Document organization boundary", () => {
  it("rejects unauthenticated, foreign org, missing org and pending identities", () => {
    expect(() => checkDocumentAccess(null, job)).toThrow();
    expect(() =>
      checkDocumentAccess({ ...user, organizationId: "another" }, job),
    ).toThrow("Job not found");
    expect(() =>
      checkDocumentAccess({ ...user, organizationId: null }, job),
    ).toThrow("Approved organization");
    expect(() =>
      checkDocumentAccess(
        { ...user, organizationAccessStatus: "pending" },
        job,
      ),
    ).toThrow("Approved organization");
    expect(() => checkDocumentAccess(user, null)).toThrow("Job not found");
  });
  it("requires dashboard access and separates read, write and managing entitlement", () => {
    expect(() =>
      checkDocumentAccess(
        {
          ...user,
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        },
        job,
      ),
    ).toThrow("dashboard access");
    expect(checkDocumentAccess(user, job)).toMatchObject({
      canWrite: true,
      canManage: false,
    });
    expect(
      checkDocumentAccess(
        {
          ...user,
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": true, "documents.manage": false },
          },
        },
        job,
      ),
    ).toMatchObject({ canWrite: false, canManage: false });
    expect(checkDocumentAccess({ ...user, role: "admin" }, job)).toMatchObject({
      canWrite: true,
      canManage: true,
    });
  });
});
