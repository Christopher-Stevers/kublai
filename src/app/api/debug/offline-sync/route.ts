import { NextResponse } from "next/server";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = (await request.json()) as unknown;
    console.log("[offline-sync-debug]", JSON.stringify(body, null, 2));
  } catch (error) {
    console.log("[offline-sync-debug] failed to parse payload", error);
  }

  return NextResponse.json({ ok: true });
}
