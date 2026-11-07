import { eq, and } from "drizzle-orm";
import { hasManagingSeat, userCan } from "~/server/auth/permissions";
import { organizationPermissionPresets } from "~/server/db/schema";
import type { DocumentAccess } from "~/server/documents/access";
import type { mutateWorkspace } from "~/server/documents/service";
type Reader = Pick<
  Parameters<Parameters<typeof mutateWorkspace>[2]>[3],
  "select"
>;
export async function canCreateFromSlip(
  access: DocumentAccess,
  reader: Reader,
) {
  if (!userCan(access.user, "orders.receive")) return false;
  if (
    hasManagingSeat(access.user) ||
    access.job.foremanUserId === access.user.id
  )
    return true;
  const role = (access.user.role ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (role === "foreman" || role === "leadhand") return true;
  if (!access.user.permissionPresetId) return false;
  const [preset] = await reader
    .select({ name: organizationPermissionPresets.name })
    .from(organizationPermissionPresets)
    .where(
      and(
        eq(organizationPermissionPresets.id, access.user.permissionPresetId),
        eq(
          organizationPermissionPresets.organizationId,
          access.job.organizationId,
        ),
      ),
    )
    .limit(1);
  return /\b(foreman|lead\s*hand)\b/i.test(preset?.name ?? "");
}
