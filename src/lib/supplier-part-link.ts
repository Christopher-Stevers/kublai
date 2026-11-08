import { z } from "zod";

export const supplierPartLinkApproval = z.object({
  lineId: z.string().max(100),
  supplierPartId: z.uuid(),
  previousPartId: z.uuid(),
  replacementPartId: z.uuid().nullable(),
  replacementPartName: z.string().min(1).max(255),
});
export type SupplierPartLinkApproval = z.infer<typeof supplierPartLinkApproval>;
export type SupplierPartLinkConflict = SupplierPartLinkApproval & {
  supplierName: string;
  supplierCode: string;
  previousPartName: string;
};
