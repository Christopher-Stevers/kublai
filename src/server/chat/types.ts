import type { db } from "~/server/db";
export type ChatTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
