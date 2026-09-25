"use client";

import { PartDetailsDialog } from "~/components/catalogue/PartDetailsDialog";

interface EditPartDialogProps {
  catalogKind?: "materials" | "assets";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partId: string | null;
}

export function EditPartDialog(props: EditPartDialogProps) {
  return <PartDetailsDialog mode="edit" {...props} />;
}
