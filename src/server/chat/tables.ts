/** Typed column boundary for the legacy circular user/job schema. */
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { users as legacyUsers, jobs as legacyJobs } from "~/server/db/schema";
import type { RequestUser } from "~/server/utils/get-request-identity";
import type { ChatJob } from "./access";
export const users = legacyUsers as unknown as PgTable &
  Record<keyof RequestUser, AnyPgColumn>;
export const jobs = legacyJobs as unknown as PgTable &
  Record<keyof ChatJob, AnyPgColumn>;
export {
  jobChatAttachments,
  jobChatEvents,
  jobChatMembers,
  jobChatMessages,
} from "~/server/db/schema";
