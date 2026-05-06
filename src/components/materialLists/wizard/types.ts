export type WizardStage = "catalog" | "material" | "size" | "category" | "part" | "review";

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
}
