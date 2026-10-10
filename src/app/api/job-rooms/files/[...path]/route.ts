import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { userCan } from "~/server/auth/permissions";
import { openJobRoomFile } from "~/server/rooms/storage";
import {
  isNotModified,
  rangeMatches,
  singleByteRange,
} from "~/server/rooms/file-response";
import { getRequestIdentity } from "~/server/utils/get-request-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function serve(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
  head = false,
) {
  const { user } = await getRequestIdentity(request.headers, {
    request,
    allowDev: true,
  });
  if (!user?.organizationId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { path } = await context.params;
  const storageKey = path.join("/");
  const jobId = path[0];
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (
    !jobId ||
    !new RegExp(
      // Drawings tiles live only under an upload folder.
      `^${uuid}/(?:${uuid}/)?(?:plan\\.pdf|floor-\\d+\\.webp)$|^${uuid}/${uuid}/tiles/\\d+/(?:manifest\\.json|[24]/\\d+_\\d+\\.webp)$`,
      "i",
    ).test(storageKey)
  ) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const [job] = await db.execute<{ id: string }>(sql`
    select id from kublai_job
    where id=${jobId} and "organizationId"=${user.organizationId}
    limit 1
  `);
  if (!job) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if ((user.organizationAccessStatus ?? "approved") !== "approved" || !userCan(user, "tab.dashboard")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  if (!userCan(user, "drawings.view")) {
    // The Rooms card uses the same storage route. Keep access to its floor
    // plans without exposing files uploaded only to the Drawings card.
    const prefix = `/api/job-rooms/files/${jobId}/${path.length >= 3 ? `${path[1]}/` : ""}`;
    const [floor] = await db.execute<{ id: string }>(sql`
      select id from kublai_job_floor where "jobId"=${jobId}
        and "organizationId"=${user.organizationId} and "imageUrl" like ${`${prefix}%`} limit 1
    `);
    if (!floor) return NextResponse.json({ error: "You don't have permission to access drawings" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    const file = await openJobRoomFile(storageKey);
    const headers = new Headers({
      "Content-Type": storageKey.endsWith(".pdf")
        ? "application/pdf"
        : storageKey.endsWith(".json")
          ? "application/json"
          : "image/webp",
      // Keep the existing one-hour private cache window. Upload-scoped paths
      // never change; legacy job-level paths may be replaced by another upload.
      "Cache-Control": `private, max-age=3600${path.length >= 3 ? ", immutable" : ""}, no-transform`,
      ETag: file.etag,
      "Last-Modified": file.modified.toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    // Auth and organization checks above must also precede metadata responses.
    if (isNotModified(request.headers, file.etag, file.modified)) {
      await file.close();
      return new NextResponse(null, { status: 304, headers });
    }
    const range =
      !head && rangeMatches(request.headers, file.etag, file.modified)
        ? singleByteRange(request.headers.get("range"), file.size)
        : null;
    if (range === "unsatisfiable") {
      await file.close();
      headers.set("Content-Range", `bytes */${file.size}`);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Content-Length", "0");
      return new NextResponse(null, { status: 416, headers });
    }
    headers.set(
      "Content-Length",
      String(range ? range.end - range.start + 1 : file.size),
    );
    if (head) {
      await file.close();
      return new NextResponse(null, { headers });
    }
    if (range)
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${file.size}`,
      );
    return new NextResponse(file.stream(range?.start, range?.end), {
      status: range ? 206 : 200,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return serve(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return serve(request, context, true);
}
