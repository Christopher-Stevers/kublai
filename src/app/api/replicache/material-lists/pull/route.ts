import { NextResponse } from "next/server";
import type { PullRequest } from "replicache";

import { createTRPCContext } from "~/server/api/trpc";
import {
  ReplicacheOwnershipError,
  handleMaterialListReplicachePull,
} from "~/server/replicache/material-list-sync";

export async function POST(request: Request) {
  const ctx = await createTRPCContext({ headers: request.headers });
  if (!ctx.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PullRequest;
  if (body.pullVersion !== 1) {
    return NextResponse.json({ error: "VersionNotSupported", versionType: "pull" });
  }

  try {
    const response = await handleMaterialListReplicachePull(body, ctx.user);
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ReplicacheOwnershipError) {
      return NextResponse.json({ error: "ClientStateNotFound" });
    }

    console.error("[replicache/material-lists/pull] failed", error);
    return NextResponse.json(
      { error: "PullFailed", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
