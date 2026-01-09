"use client";

import { api } from "~/trpc/react";
import { PreferredSupplierSelector } from "./PreferredSupplierSelector";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { StarIcon } from "lucide-react";

export function PartsList() {
  const { data: parts, isLoading } = api.supplier.getAllPartsWithPreferred.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading parts...</p>
      </div>
    );
  }

  if (!parts || parts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <h3 className="mt-4 text-lg font-semibold">No parts yet</h3>
        <p className="text-muted-foreground mt-2">
          Parts will appear here once they are added to your catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parts.map((part) => (
        <Card key={part.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {part.displayName}
                {part.preferredSupplier && (
                  <Badge variant="default" className="gap-1">
                    <StarIcon className="h-3 w-3" />
                    Preferred Supplier Set
                  </Badge>
                )}
              </CardTitle>
            </div>
            {part.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {part.description}
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Preferred Supplier
                </label>
                <PreferredSupplierSelector
                  partDefinitionId={part.id}
                  currentPreferredSupplierId={
                    part.preferredSupplier?.id || null
                  }
                  availableSuppliers={part.availableSuppliers}
                />
              </div>
              {part.availableSuppliers.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Available from {part.availableSuppliers.length} supplier
                    {part.availableSuppliers.length !== 1 ? "s" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {part.availableSuppliers.map((supplier) => (
                      <Badge
                        key={supplier.id}
                        variant={
                          part.preferredSupplier?.id === supplier.id
                            ? "default"
                            : "outline"
                        }
                      >
                        {supplier.name}
                        {part.preferredSupplier?.id === supplier.id && (
                          <StarIcon className="ml-1 h-3 w-3" />
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {part.availableSuppliers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No suppliers configured for this part yet. Add parts to
                  suppliers from the Suppliers page.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

