import { snapshotSourceSchema } from "~/lib/snapshot-source";
import { NextResponse } from "next/server";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { ORGANIZATION_INVITE_COOKIE } from "~/lib/organization-invite";
import { organizationInvites, users } from "~/server/db/schema";

const PUBLIC_APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://foremanhq.stellarator.work"
).replace(/\/+$/, "");

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, PUBLIC_APP_URL || request.url));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { userId, user } = await getRequestIdentity(request.headers);

  if (!userId) {
    const response = redirectTo(request, "/sign-in");
    response.cookies.set(ORGANIZATION_INVITE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return response;
  }

  if (!user) {
    return redirectTo(request, "/onboarding");
  }

  const [invite] = await db
    .select()
    .from(organizationInvites)
    .where(
      and(
        eq(organizationInvites.token, token),
        isNull(organizationInvites.revokedAt),
        gt(organizationInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!invite) {
    const response = redirectTo(request, "/onboarding");
    response.cookies.delete(ORGANIZATION_INVITE_COOKIE);
    return response;
  }

  if (user.organizationId && user.organizationId !== invite.organizationId) {
    const response = redirectTo(request, "/dashboard");
    response.cookies.delete(ORGANIZATION_INVITE_COOKIE);
    return response;
  }

  const landing = snapshotSourceSchema.safeParse(invite.defaultLandingPage);

  await db
    .update(users)
    .set({
      organizationId: invite.organizationId,
      role: user.role === "admin" ? user.role : invite.role,
      permissionConfig: invite.permissionConfig,
      ...(landing.success && !user.defaultLandingPage ? { defaultLandingPage: landing.data } : {}),
      organizationAccessStatus:
        user.organizationId === invite.organizationId
          ? user.organizationAccessStatus
          : "approved",
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const response = redirectTo(request, landing.success ? landing.data.href : "/dashboard");
  response.cookies.delete(ORGANIZATION_INVITE_COOKIE);
  return response;
}
