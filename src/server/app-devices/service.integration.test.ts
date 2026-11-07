// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { recordAppDevice, organizationAppDevices } from "./service";
const url = process.env.APP_DEVICE_TEST_DATABASE_URL;
describe.skipIf(!url)("isolated device reporting database", () => {
  const schema = "app_device_test_" + randomUUID().replaceAll("-", "");
  const conn = postgres(url!, { max: 1 });
  const db = drizzle(conn);
  const org = randomUUID(),
    otherOrg = randomUUID(),
    deviceId = randomUUID();
  const report = {
    deviceId,
    deviceType: "phone" as const,
    platform: "Android",
    mode: "browser" as const,
    installButtonVisible: true,
  };
  beforeAll(async () => {
    await conn.unsafe(`CREATE SCHEMA ${schema}`);
    await conn.unsafe(`SET search_path TO ${schema}`);
    await conn.unsafe(
      'CREATE TABLE kublai_user (id varchar(255) PRIMARY KEY, "organizationId" uuid)',
    );
    await conn.unsafe(
      await readFile("drizzle/0063_app_device_observations.sql", "utf8"),
    );
  });
  afterAll(async () => {
    await conn.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await conn.end();
  });
  beforeEach(async () => {
    await conn.unsafe("TRUNCATE kublai_user CASCADE");
    await conn`INSERT INTO kublai_user VALUES ('member',${org}),('other',${otherOrg})`;
  });
  it("retains installed-app evidence when a later browser visit shows the button", async () => {
    await recordAppDevice(db, "member", {
      ...report,
      mode: "installed-app",
      installButtonVisible: false,
    });
    const [first] = await organizationAppDevices(db, org);
    await recordAppDevice(db, "member", report);
    const [last] = await organizationAppDevices(db, org);
    expect(last!.mode).toBe("browser");
    expect(last!.installButtonVisible).toBe(true);
    expect(last!.installedAppLastSeenAt).toBe(first!.installedAppLastSeenAt);
    expect(last!.deviceId).toBe(deviceId);
  });
  it("separates accounts sharing a browser profile and scopes organization results", async () => {
    await recordAppDevice(db, "member", report);
    await recordAppDevice(db, "other", { ...report, mode: "installed-app" });
    const a = await organizationAppDevices(db, org),
      b = await organizationAppDevices(db, otherOrg);
    expect(a.map((d) => d.userId)).toEqual(["member"]);
    expect(b.map((d) => d.userId)).toEqual(["other"]);
    expect(a[0]!.installedAppLastSeenAt).toBeNull();
  });
  it("throttles unchanged reports but records visibility changes immediately", async () => {
    await recordAppDevice(db, "member", report);
    await conn`UPDATE kublai_app_device_observation SET "lastSeenAt"=now()-interval '1 minute'`;
    const [before] = await organizationAppDevices(db, org);
    await recordAppDevice(db, "member", report);
    expect((await organizationAppDevices(db, org))[0]!.lastSeenAt).toBe(
      before!.lastSeenAt,
    );
    await recordAppDevice(db, "member", {
      ...report,
      installButtonVisible: false,
    });
    expect((await organizationAppDevices(db, org))[0]!.lastSeenAt).not.toBe(
      before!.lastSeenAt,
    );
  });
  it("does not label browser users as uninstalled and removes reports with deleted users", async () => {
    await recordAppDevice(db, "member", report);
    expect(
      (await organizationAppDevices(db, org))[0]!.installedAppLastSeenAt,
    ).toBeNull();
    await conn`DELETE FROM kublai_user WHERE id='member'`;
    expect(await organizationAppDevices(db, org)).toEqual([]);
  });
});
