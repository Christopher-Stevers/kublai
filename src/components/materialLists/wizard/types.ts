export type WizardStage =
  | "catalog"
  | "material"
  | "size"
  | "category"
  | "part";

export interface PendingSupplierPartSnapshot {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  packSize?: string | null;
  supplier: {
    id: string;
    name: string;
  };
}

export interface PendingPart {
  manualSupplier?: boolean;
  supplierVersion?: import("~/lib/job-supplier-defaults").SupplierVersion | null;
  isTool?: boolean;
  partId: string;
  partDefinition: {
    id: string;
    displayName: string;
    piecesPerPack?: number | null;
    bulkUnit?: string | null;
    individualUnit?: string | null;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  };
  quantity: number;
  supplierPartId?: string;
  supplierPartSnapshot?: PendingSupplierPartSnapshot | null;
}
