import { NextResponse } from "next/server";
import type { PushRequest } from "replicache";

import { createTRPCContext } from "~/server/api/trpc";
import { handleMaterialListReplicachePush } from "~/server/replicache/material-list-sync";

export async function POST(request: Request) {
  const ctx = await createTRPCContext({ headers: request.headers });
  if (!ctx.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PushRequest;
  if (body.pushVersion !== 1) {
    return NextResponse.json({ error: "VersionNotSupported", versionType: "push" });
  }

  try {
    const response = await handleMaterialListReplicachePush(body, ctx.user);
    return NextResponse.json(response);
  } catch (error) {
    console.error("[replicache/material-lists/push] failed", error);
    return NextResponse.json(
      { error: "PushFailed", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
