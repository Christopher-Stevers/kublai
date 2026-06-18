import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "~/server/db";
import { ORGANIZATION_INVITE_COOKIE } from "~/lib/organization-invite";
import { organizationInvites, users } from "~/server/db/schema";
import { ensureUser } from "~/server/utils/ensure-user";

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
  const { userId } = await auth();

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

  const user = await ensureUser(userId);
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

  await db
    .update(users)
    .set({
      organizationId: invite.organizationId,
      role: user.role === "admin" ? user.role : invite.role,
      permissionConfig: invite.permissionConfig,
      organizationAccessStatus:
        user.organizationId === invite.organizationId
          ? user.organizationAccessStatus
          : "approved",
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const response = redirectTo(request, "/dashboard");
  response.cookies.delete(ORGANIZATION_INVITE_COOKIE);
  return response;
}
