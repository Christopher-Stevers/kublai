import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { readJobRoomFile } from "~/server/rooms/storage";
import { getRequestIdentity } from "~/server/utils/get-request-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { user } = await getRequestIdentity(request.headers, {
    allowDev: true,
  });
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await context.params;
  const storageKey = path.join("/");
  const jobId = path[0];
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (
    !jobId ||
    !new RegExp(
      `^${uuid}/(?:${uuid}/)?(?:plan\\.pdf|floor-\\d+\\.webp)$`,
      "i",
    ).test(storageKey)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [job] = await db.execute<{ id: string }>(sql`
    select id from kublai_job
    where id=${jobId} and "organizationId"=${user.organizationId}
    limit 1
  `);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await readJobRoomFile(storageKey);
    const contentType = storageKey.endsWith(".pdf")
      ? "application/pdf"
      : "image/webp";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
