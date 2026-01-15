"use client";

import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Package } from "lucide-react";
import Image from "next/image";
import { PartSuppliersDropdown } from "~/components/catalogue/PartSuppliersDropdown";

interface PartCardProps {
  part: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    material: string | null;
    partType: string | null;
    size: string | null;
  };
  onEdit: (partId: string) => void;
  supplierInfo?: {
    preferredSupplier: { id: string; name: string } | null;
    availableSuppliers: Array<{ id: string; name: string }>;
  };
}

export function PartCard({
  part,
  onEdit,
  supplierInfo,
}: PartCardProps) {
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <div
        className="relative aspect-square cursor-pointer bg-gray-100"
        onClick={() => onEdit(part.id)}
      >
        {part.imageUrl ? (
          <Image
            src={part.imageUrl}
            alt={part.displayName}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-12 w-12 text-gray-400" />
          </div>
        )}
      </div>
      <CardContent className="p-4">
        <h3
          className="mb-2 line-clamp-2 font-medium text-gray-900 cursor-pointer hover:text-blue-600"
          onClick={() => onEdit(part.id)}
        >
          {part.displayName}
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {part.partType && (
            <Badge variant="secondary" className="text-xs">
              {part.partType}
            </Badge>
          )}
          {part.size && (
            <Badge variant="secondary" className="text-xs">
              {part.size}
            </Badge>
          )}
          {part.material && (
            <Badge variant="secondary" className="text-xs">
              {part.material}
            </Badge>
          )}
        </div>
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <PartSuppliersDropdown
            partDefinitionId={part.id}
            currentPreferredSupplierId={
              supplierInfo?.preferredSupplier?.id || null
            }
            availableSuppliers={supplierInfo?.availableSuppliers ?? []}
          />
        </div>
      </CardContent>
    </Card>
  );
}

