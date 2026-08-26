import { NextResponse } from "next/server";

import { createTRPCContext } from "~/server/api/trpc";

export async function POST(request: Request) {
  const ctx = await createTRPCContext({ headers: request.headers });
  if (!ctx.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  void request;
  return NextResponse.json({});
}
