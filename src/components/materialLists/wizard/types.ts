export type WizardStage = "catalog" | "material" | "size" | "partTypeCategory" | "part" | "review";

export interface PendingPart {
  partId: string;
  partDefinition: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    partType: string | null;
  };
  quantity: number;
  supplierPartId?: string;
}

