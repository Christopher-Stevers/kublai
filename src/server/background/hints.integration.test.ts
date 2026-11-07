// @vitest-environment node
import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import postgres from "postgres";
const socket = process.env.PURCHASE_TEST_SOCKET;
it.skipIf(!socket)(
  "passes sanitized hints between independent processes through PostgreSQL",
  async () => {
    if (!socket?.startsWith("/tmp/foremanhq-purchase-pg."))
      throw Error("Refusing non-isolated database");
    const sql = postgres({
      host: socket,
      port: 55461,
      database: "purchase_integration",
      max: 2,
    });
    const connectionUrl = "postgres:///purchase_integration";
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
 import {startBackgroundHints,onBackgroundHint,publishBackgroundHint} from './src/server/background/hints.ts';
 onBackgroundHint(hint=>process.send({hint}));
 await startBackgroundHints();process.send({ready:true});
 process.on('message',()=>publishBackgroundHint({topic:'poke',organizationId:'test-company'}));
 `,
      ],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: connectionUrl,
          PGHOST: socket,
          PGPORT: "55461",
        },
      },
    );
    const inbox: unknown[] = [];
    child.on("message", (m) => inbox.push(m));
    let error = "";
    child.stderr!.on("data", (d) => {
      error += String(d).slice(0, 500);
    });
    const wait = async (predicate: () => boolean) => {
      for (let i = 0; i < 200 && !predicate(); i++)
        await new Promise((r) => setTimeout(r, 10));
      if (!predicate()) throw Error("Hint child failed: " + error);
    };
    try {
      await wait(() => inbox.some((x) => (x as { ready?: boolean }).ready));
      await sql.notify(
        "foremanhq_change",
        JSON.stringify({
          origin: "00000000-0000-4000-8000-000000000001",
          hint: {
            topic: "conversation",
            conversationId: "test-conversation",
            text: "must be stripped",
          },
        }),
      );
      await wait(() => inbox.some((x) => !!(x as { hint?: unknown }).hint));
      expect(inbox).toContainEqual({
        hint: { topic: "conversation", conversationId: "test-conversation" },
      });
      let outgoing = "";
      const listener = await sql.listen("foremanhq_change", (x) => {
        outgoing = x;
      });
      child.send({ publish: true });
      await wait(() => !!outgoing);
      expect((JSON.parse(outgoing) as { hint: unknown }).hint).toEqual({
        topic: "poke",
        organizationId: "test-company",
      });
      await listener.unlisten();
    } finally {
      child.kill("SIGKILL");
      await sql.end();
    }
  },
  10_000,
);
