"use client";

import { PartDetailsDialog } from "~/components/catalogue/PartDetailsDialog";

interface CreateCustomPartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPartCreated: (part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    size: string | null;
    supplierPartId?: string;
  }) => void;
  initialContext?: {
    catalogId?: string | null;
    materialId?: string | null;
    size?: { nominal: number; unit: string } | null;
    categoryId?: string | null;
    categoryName?: string | null;
  };
}

export function CreateCustomPartDialog(props: CreateCustomPartDialogProps) {
  return <PartDetailsDialog mode="create" {...props} />;
}
