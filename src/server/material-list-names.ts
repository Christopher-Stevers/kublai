import { and, eq } from "drizzle-orm";

import { getNextMaterialListNameFromNames } from "~/lib/material-list-names";
import { materialLists } from "~/server/db/schema";

type MaterialListNameDb = {
  select: typeof import("~/server/db").db.select;
};

export { isDefaultMaterialListName } from "~/lib/material-list-names";

export async function getNextDefaultMaterialListName(
  db: MaterialListNameDb,
  input: {
    organizationId: string;
    jobId: string;
    from?: Date;
  },
) {
  const existingLists = await db
    .select({ name: materialLists.name })
    .from(materialLists)
    .where(
      and(
        eq(materialLists.organizationId, input.organizationId),
        eq(materialLists.jobId, input.jobId),
      ),
    );

  return getNextMaterialListNameFromNames(
    existingLists.map((list) => list.name),
    input.from,
  );
}
