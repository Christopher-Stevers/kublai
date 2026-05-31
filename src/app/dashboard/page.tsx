import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { DashboardClient, type DashboardJob } from "./DashboardClient";
import { db } from "~/server/db";
import { jobs, locations, materialLists, users } from "~/server/db/schema";
import { ensureUser } from "~/server/utils/ensure-user";
import { getAgentBypassUser } from "~/server/utils/get-agent-bypass-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";
import { headers } from "next/headers";

async function getInitialJobs(): Promise<DashboardJob[]> {
  const { userId: clerkUserId } = await auth();
  const requestHeaders = await headers();
  const bypassUser =
    clerkUserId ? null : ((await getAgentBypassUser(requestHeaders)) ?? (await getDevBypassUser()));
  const userId = clerkUserId ?? bypassUser?.id;
  if (!userId) return [];

  const user = await ensureUser(userId);
  if (!user?.organizationId) return [];

  return db
    .select({
      id: jobs.id,
      name: jobs.name,
      poNumber: jobs.poNumber,
      locationId: jobs.locationId,
      foremanName: jobs.foremanName,
      status: jobs.status,
      createdAt: jobs.createdAt,
      location: {
        id: locations.id,
        name: locations.name,
        address1: locations.address1,
        address2: locations.address2,
        city: locations.city,
        region: locations.region,
        postalCode: locations.postalCode,
        country: locations.country,
      },
      foreman: {
        id: users.id,
        name: sql<string | null>`coalesce(${jobs.foremanName}, ${users.name})`,
      },
      materialListCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${materialLists}
        WHERE ${materialLists.jobId} = ${jobs.id}
          AND ${materialLists.organizationId} = ${user.organizationId}
      )`,
    })
    .from(jobs)
    .leftJoin(locations, eq(jobs.locationId, locations.id))
    .leftJoin(users, eq(jobs.foremanUserId, users.id))
    .where(eq(jobs.organizationId, user.organizationId))
    .orderBy(desc(jobs.createdAt));
}

export default async function Dashboard() {
  const initialJobs = await getInitialJobs();
  return <DashboardClient initialJobs={initialJobs} />;
}
