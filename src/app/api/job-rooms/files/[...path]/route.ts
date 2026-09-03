import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { readJobRoomFile } from "~/server/rooms/storage";
import { ensureUser } from "~/server/utils/ensure-user";
import { getAgentBypassUser } from "~/server/utils/get-agent-bypass-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getRequestUser(request: Request) {
  const { userId } = await auth();
  if (userId) return ensureUser(userId);
  const headers = request.headers;
  return (await getAgentBypassUser(headers)) ?? (await getDevBypassUser());
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const user = await getRequestUser(request);
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path } = await context.params;
  const storageKey = path.join("/");
  if (
    !/^[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\/)?(?:plan\.pdf|floor-\d+\.webp)$/i.test(
      storageKey,
    )
  ) {
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
