// @vitest-environment node
/** Executed only by the guarded, source-bound private-PG proof wrapper. */
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import {
  privateChatOptions,
  assertClientOptions,
  assertServerIdentity,
} from "./chat-overview-pg-guard.mjs";
vi.mock("~/server/db", async () => {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { privateChatOptions, assertClientOptions } =
    await import("./chat-overview-pg-guard.mjs");
  const options = privateChatOptions(),
    connection = postgres(options);
  assertClientOptions(connection, options); // Connection is lazy: assert before SQL.
  return { db: drizzle(connection), __proofConnection: connection };
});
vi.mock("~/server/chat/push", () => ({
  enqueueChatPush: () => {
    throw Error("Push is outside this proof");
  },
}));
import * as database from "~/server/db";
import * as schema from "~/server/db/schema";
import {
  joinChat,
  markChatRead,
  setChatNotifications,
} from "~/server/chat/service";
import { notifyChatOverviewChange } from "~/server/chat/overview-hints";
import { acceptBackgroundHint } from "~/server/background/hints";
import { subscribeChatOverviewEvents } from "~/server/live/chat-overview-events";
import type { ChatAccess } from "~/server/chat/access";
const conn = (
  database as typeof database & { __proofConnection: import("postgres").Sql }
).__proofConnection;
const db = database.db;
const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actor = "chat-overview-actor";
const access = {
  job: { id: job, organizationId: org, name: "Synthetic job" },
  user: { id: actor },
  canModerate: false,
} as ChatAccess;
const delivered: string[] = [],
  self = vi.fn(),
  foreign = vi.fn();
let child: ChildProcess,
  stops: (() => void)[] = [];
const barriers = new Map<string, () => void>();
async function drainListener() {
  const marker = randomUUID();
  let timer: ReturnType<typeof setTimeout>;
  const acknowledged = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      barriers.delete(marker);
      reject(Error("Listener barrier timeout"));
    }, 3000);
    barriers.set(marker, () => {
      clearTimeout(timer);
      barriers.delete(marker);
      resolve();
    });
  });
  await conn`select pg_notify('foremanhq_change', ${JSON.stringify({ proofBarrier: marker })})`;
  await acknowledged;
}
async function oneMore(before: number) {
  await vi.waitFor(() => expect(delivered).toHaveLength(before + 1), {
    timeout: 3000,
    interval: 20,
  });
}
beforeAll(async () => {
  const identity = await assertServerIdentity(conn, privateChatOptions());
  await writeFile(
    process.env.CHAT_OVERVIEW_EVIDENCE + "/server-identity.json",
    JSON.stringify(identity, null, 2),
  );
  for (const table of [schema.organizations, schema.users, schema.jobs]) {
    const columns = Object.values(getTableColumns(table)).map(
      (column) => `"${column.name}" ${column.getSQLType()}`,
    );
    await conn.unsafe(
      `CREATE TABLE "${getTableName(table)}" (${columns.join(",")},PRIMARY KEY ("id"))`,
    );
  }
  // This is the recorded committed 0042 fixture copy, not the working migration journal.
  await conn.unsafe(
    await readFile(
      new URL("./chat-overview-fixture.sql", import.meta.url),
      "utf8",
    ),
  );
  await conn`insert into kublai_organization(id,name) values (${org},'Synthetic organization')`;
  await conn`insert into kublai_user(id,email,name) values (${actor},'overview@example.invalid','Synthetic actor')`;
  await conn`insert into kublai_job(id,name) values (${job},'Synthetic job')`;
  await conn`create table overview_business_probe (id integer primary key)`;
  const tables =
    await conn`select tablename from pg_tables where schemaname='public' order by tablename`;
  await writeFile(
    process.env.CHAT_OVERVIEW_EVIDENCE + "/fixture-inventory.json",
    JSON.stringify(
      {
        scope:
          "thin synthetic fixture: base columns/PK plus committed chat migration; not full application schema",
        tables,
      },
      null,
      2,
    ),
  );
  child = fork(
    new URL("./chat-overview-pg-listener.mjs", import.meta.url),
    [],
    {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, DATABASE_URL: undefined },
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Private listener readiness timeout")),
      5000,
    );
    child.once("error", reject);
    child.on("message", (value: unknown) => {
      const message = value as { type: string; payload?: string };
      if (message.type === "ready") {
        clearTimeout(timeout);
        resolve();
      }
      if (message.type === "hint" && message.payload) {
        const barrier = JSON.parse(message.payload) as {
          proofBarrier?: string;
        };
        if (barrier.proofBarrier) {
          barriers.get(barrier.proofBarrier)?.();
          return;
        }
        delivered.push(message.payload);
        acceptBackgroundHint(message.payload);
      }
    });
  });
  stops = [
    subscribeChatOverviewEvents(
      { organizationId: org, userId: actor, jobIds: new Set([job]) },
      self,
    ),
    subscribeChatOverviewEvents(
      { organizationId: org, userId: "peer", jobIds: new Set([job]) },
      foreign,
    ),
  ];
});
afterAll(async () => {
  stops.forEach((stop) => stop());
  try {
    if (child && child.exitCode === null && child.connected) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(Error("Listener cleanup forced"));
        }, 3000);
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0 ? resolve() : reject(Error("Listener exit failed"));
        });
        child.send("stop");
      });
    }
  } finally {
    await conn.end({ timeout: 2 });
    let listenerPidAbsent = false;
    try {
      if (child?.pid) process.kill(child.pid, 0);
    } catch (error) {
      listenerPidAbsent = (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    await writeFile(
      process.env.CHAT_OVERVIEW_EVIDENCE + "/proof-summary.json",
      JSON.stringify(
        {
          deliveredHints: delivered.length,
          matchingActorCallbacks: self.mock.calls.length,
          foreignCallbacks: foreign.mock.calls.length,
          listenerPid: child?.pid,
          listenerExitCode: child?.exitCode,
          listenerPidAbsent,
        },
        null,
        2,
      ),
    );
    expect(child?.exitCode).toBe(0);
    expect(listenerPidAbsent).toBe(true);
  }
});

it("committed real join/mute/read changes traverse independent LISTEN and exact actor/job scope; repeats do not", async () => {
  let n = delivered.length;
  await joinChat(access);
  await oneMore(n);
  expect(self).toHaveBeenCalledTimes(1);
  expect(foreign).not.toHaveBeenCalled();
  n = delivered.length;
  await joinChat(access);
  await drainListener();
  expect(delivered).toHaveLength(n);
  await setChatNotifications(access, true);
  await oneMore(n);
  n = delivered.length;
  await setChatNotifications(access, true);
  await drainListener();
  expect(delivered).toHaveLength(n);
  // Synthetic message advances the actual durable read cursor; no send/push call.
  await conn`insert into kublai_job_chat_message(id,"jobId","authorId","clientId","requestHash",body) values ('11111111-1111-4111-8111-111111111111',${job},${actor},'22222222-2222-4222-8222-222222222222','proof','synthetic')`;
  await markChatRead(access, 1);
  await oneMore(n);
  n = delivered.length;
  await markChatRead(access, 1);
  await drainListener();
  expect(delivered).toHaveLength(n);
  expect(self).toHaveBeenCalledTimes(3);
  expect(foreign).not.toHaveBeenCalled();
  expect(delivered.map((p) => JSON.parse(p).hint)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        topic: "chat-overview",
        organizationId: org,
        userId: actor,
        jobId: job,
      }),
    ]),
  );
});
it("outer rollback suppresses a real helper notification and business row", async () => {
  const n = delivered.length;
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(sql`insert into overview_business_probe values (1)`);
      await notifyChatOverviewChange(tx, access);
      throw Error("deliberate outer rollback");
    }),
  ).rejects.toThrow("deliberate outer rollback");
  await drainListener();
  expect(delivered).toHaveLength(n);
  expect(
    await conn`select * from overview_business_probe where id=1`,
  ).toHaveLength(0);
});
it("ordinary pg_notify permission error rolls back nested savepoint while outer business write commits", async () => {
  const n = delivered.length;
  await conn`create role chat_overview_limited`;
  await conn`grant insert on overview_business_probe to chat_overview_limited`;
  await conn`revoke execute on function pg_notify(text,text) from public`;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role chat_overview_limited`);
      await tx.execute(sql`insert into overview_business_probe values (2)`);
      await notifyChatOverviewChange(tx, access);
      await tx.execute(sql`insert into overview_business_probe values (3)`);
    });
  } finally {
    await conn`grant execute on function pg_notify(text,text) to public`;
  }
  expect(
    await conn`select id from overview_business_probe where id in (2,3) order by id`,
  ).toEqual([{ id: 2 }, { id: 3 }]);
  await drainListener();
  expect(delivered).toHaveLength(n);
  const log = await readFile(privateChatOptions().host + "/server.log", "utf8");
  expect(log).toMatch(
    /ERROR:\s+42501: permission denied for function pg_notify/,
  );
  await writeFile(
    process.env.CHAT_OVERVIEW_EVIDENCE + "/expected-error.json",
    JSON.stringify(
      {
        observedSQLSTATE: "42501",
        expectedMessage: "permission denied for function pg_notify",
        businessRowsCommitted: [2, 3],
        hintDelivered: false,
      },
      null,
      2,
    ),
  );
});
