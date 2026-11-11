// @vitest-environment node
import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { saveMaterialSortPreferences } from "./material-sort-preferences";
import { defaultMaterialSortSettings } from "~/lib/material-sort-preferences";
import type { db } from "~/server/db";
const socket = process.env.PREFERENCE_TEST_SOCKET;
it.skipIf(!socket)(
  "commits cross-process hints, suppresses no-op and rolled-back notifications",
  async () => {
    if (!socket?.startsWith("/tmp/foremanhq-preference-pg."))
      throw Error("Private preference database required");
    const sql = postgres({
      host: socket,
      port: 55467,
      database: "preference_test",
      max: 2,
    });
    const inbox: unknown[] = [];
    const epochs: unknown[] = [];
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
 import {startBackgroundHints,onBackgroundHint,onBackgroundHintReconnect} from './src/server/background/hints.ts';
 onBackgroundHint(hint=>process.send({hint}));onBackgroundHintReconnect(revision=>process.send({epoch:revision}));await startBackgroundHints();process.send({ready:true});
 `,
      ],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: "postgres:///preference_test",
          PGHOST: socket,
          PGPORT: "55467",
        },
      },
    );
    child.on("message", (m) => {
      if ((m as { epoch?: unknown }).epoch) epochs.push(m);
      else inbox.push(m);
    });
    let stderr = "";
    child.stderr!.on("data", (d) => (stderr += String(d).slice(0, 400)));
    const wait = async (predicate: () => boolean) => {
      for (let i = 0; i < 200 && !predicate(); i++)
        await new Promise((r) => setTimeout(r, 10));
      if (!predicate()) throw Error("Listener timeout " + stderr);
    };
    const dialect = new PgDialect();
    let failAfterNotify = false;
    const database = {
      transaction: async (run: (tx: unknown) => Promise<void>) =>
        sql.begin(async (tx) => {
          await run({
            execute: async (
              query: Parameters<typeof dialect.sqlToQuery>[0],
            ) => {
              const q = dialect.sqlToQuery(query);
              const rows = await tx.unsafe(
                q.sql,
                q.params.map((value) => {
                  if (typeof value !== "string" && typeof value !== "boolean")
                    throw Error("Unexpected synthetic SQL parameter");
                  return value;
                }),
              );
              if (failAfterNotify && q.sql.includes("pg_notify"))
                throw Error("rollback probe");
              return rows;
            },
          });
        }),
    } as unknown as typeof db;
    const org = "11111111-1111-4111-8111-111111111111";
    try {
      await sql`create table kublai_material_sort_preference(organization_id uuid,scope text,settings jsonb,custom boolean,unique(organization_id,scope))`;
      await wait(() => inbox.some((x) => (x as { ready?: boolean }).ready));
      await saveMaterialSortPreferences(
        database,
        org,
        "crew",
        defaultMaterialSortSettings,
        true,
      );
      await wait(() => inbox.length === 2);
      expect(inbox[1]).toEqual({
        hint: {
          topic: "preferences",
          organizationId: org,
          scope: "personal",
          userId: "crew",
          eventId: expect.any(String) as unknown,
        },
      });
      await saveMaterialSortPreferences(
        database,
        org,
        "crew",
        defaultMaterialSortSettings,
        true,
        true,
      );
      failAfterNotify = true;
      await expect(
        saveMaterialSortPreferences(
          database,
          org,
          "executive",
          defaultMaterialSortSettings,
          false,
        ),
      ).rejects.toThrow("rollback probe");
      await new Promise((r) => setTimeout(r, 150));
      expect(inbox).toHaveLength(2);
      const rows = await sql`select scope from kublai_material_sort_preference`;
      expect(rows.map((r) => r.scope as unknown)).toEqual(["crew"]);
      expect(epochs).toHaveLength(1);
      const listeners =
        await sql`select pid from pg_stat_activity where datname = current_database() and query ilike 'listen%'`;
      expect(listeners).toHaveLength(1);
      await sql`select pg_terminate_backend(${listeners[0]!.pid as number})`;
      await wait(() => epochs.length === 2);
      expect(epochs[0]).not.toEqual(epochs[1]);
    } finally {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode) resolve();
        else child.once("exit", () => resolve());
      });
      await sql.end();
    }
  },
  10_000,
);
