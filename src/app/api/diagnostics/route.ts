import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { userCan } from "~/server/auth/permissions";
import { diagnosticEvent } from "~/lib/diagnostics";
export const dynamic = "force-dynamic";
const limits = new Map<string, { at: number; count: number }>();
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    Number(request.headers.get("content-length") ?? 0) > 1024
  )
    return response({}, 400);
  const { user, simulation } = await getRequestIdentity(request.headers, {
    request,
  });
  if (!user?.organizationId || user.organizationAccessStatus !== "approved")
    return response({}, 401);
  if (simulation) return response({ ok: true });
  const now = Date.now();
  for (const [key, value] of limits)
    if (now - value.at > 3600000) limits.delete(key);
  const limit = limits.get(user.id) ?? { at: now, count: 0 };
  if (limit.count >= 60 || limits.size > 10000) return response({}, 429);
  limit.count++;
  limits.set(user.id, limit);
  const reader = request.body?.getReader();
  if (!reader) return response({}, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 1024) {
      await reader.cancel();
      return response({}, 400);
    }
    chunks.push(chunk.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed;
  try {
    parsed = diagnosticEvent.safeParse(JSON.parse(text));
  } catch {
    return response({}, 400);
  }
  if (!parsed.success) return response({}, 400);
  const e = parsed.data;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`delete from kublai_diagnostic_count where day < CURRENT_DATE - 30`,
    );
    await tx.execute(sql`insert into kublai_diagnostic_count (organization_id,kind,feature,device,release,code,duration)
      values (${user.organizationId}::uuid,${e.kind},${e.feature},${e.device},${e.release},${e.code},${e.duration})
      on conflict (organization_id,day,kind,feature,device,release,code,duration)
      do update set count=least(kublai_diagnostic_count.count+1,1000000)`);
  });
  return response({ ok: true });
}
export async function GET(request: Request) {
  const { user } = await getRequestIdentity(request.headers);
  if (!user?.organizationId || user.organizationAccessStatus !== "approved")
    return response({}, 401);
  if (!userCan(user, "org.settings")) return response({}, 403);
  const rows = await db.execute(
    sql`select kind,feature,device,release,code,duration,sum(count)::int as reports from kublai_diagnostic_count where organization_id=${user.organizationId}::uuid and day >= CURRENT_DATE - 30 group by kind,feature,device,release,code,duration order by sum(count) desc limit 100`,
  );
  return response({ rows });
}
