import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { APP_NAME } from "~/constants/app";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  try {
    await db.execute(sql`select 1 as ok`);

    return NextResponse.json(
      {
        ok: true,
        app: APP_NAME,
        timestamp: new Date().toISOString(),
        checks: {
          database: "ok",
        },
        latencyMs: Date.now() - startedAt,
      },
      {
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Health check failed", error);

    return NextResponse.json(
      {
        ok: false,
        app: APP_NAME,
        timestamp: new Date().toISOString(),
        checks: {
          database: "failed",
        },
        latencyMs: Date.now() - startedAt,
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  }
}
