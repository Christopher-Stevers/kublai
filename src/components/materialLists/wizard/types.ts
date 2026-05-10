export type WizardStage = "catalog" | "material" | "size" | "category" | "part" | "review";

export interface PendingSupplierPartSnapshot {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastKnownUnitCost: string | null;
  supplier: {
    id: string;
    name: string;
  };
}

export interface PendingPart {
  partId: string;
  partDefinition: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
  };
  quantity: number;
  supplierPartId?: string;
  supplierPartSnapshot?: PendingSupplierPartSnapshot | null;
}
