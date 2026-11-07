import { and, eq } from "drizzle-orm";
import type { db } from "~/server/db";
import { jobRooms } from "~/server/db/schema";

export class MaterialRoomAssignmentError extends Error {}

/** Missing input inherits the list's room; an explicit null deliberately stays blank. */
export async function resolveMaterialRoom(
  database: Pick<typeof db, "select">,
  input: {
    organizationId: string;
    jobId: string;
    roomId?: string | null;
    defaultRoomId?: string | null;
  },
): Promise<string | null> {
  const roomId = input.roomId === undefined ? input.defaultRoomId ?? null : input.roomId;
  if (!roomId) return null;
  const [room] = await database
    .select({ id: jobRooms.id })
    .from(jobRooms)
    .where(and(
      eq(jobRooms.id, roomId),
      eq(jobRooms.jobId, input.jobId),
      eq(jobRooms.organizationId, input.organizationId),
    ))
    .limit(1);
  if (!room) throw new MaterialRoomAssignmentError("Room does not belong to this job or is no longer available");
  return room.id;
}
