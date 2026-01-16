"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import Image from "next/image";
import { X } from "lucide-react";

interface ValveSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: string; // Keep as string for display, but we'll need materialId
  materialId: string | null;
  size: { nominal: number; unit: string };
  onValveSelected: (partId: string) => void;
}

export function ValveSelectionDialog({
  open,
  onOpenChange,
  material,
  materialId,
  size,
  onValveSelected,
}: ValveSelectionDialogProps) {
  // Get partTypes to find "valve" partTypeId
  const { data: partTypes } = api.catalogue.getPartTypes.useQuery(
    {},
    { enabled: open },
  );

  // Find partTypeId for "valve" (could be "ball valve", "gate valve", etc.)
  // For now, we'll search for parts with partType containing "valve"
  // Actually, let's just search without partType filter and filter client-side
  const { data: valveParts, isLoading } = api.catalogue.searchParts.useQuery(
    {
      materialId: materialId ?? undefined,
      sizeNominal: size.nominal,
      sizeUnit: size.unit,
    },
    { enabled: open && !!materialId },
  );

  // Filter to only valve parts (partType contains "valve")
  const filteredValveParts = valveParts?.filter(
    (part) => part.partType?.toLowerCase().includes("valve"),
  );

  const handleValveSelect = (partId: string) => {
    onValveSelected(partId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Valve Type</DialogTitle>
          <DialogDescription>
            Choose a valve type for {material} {size.nominal} {size.unit}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <p className="py-8 text-center text-gray-500">Loading valves...</p>
          ) : !filteredValveParts || filteredValveParts.length === 0 ? (
            <p className="py-8 text-center text-gray-500">
              No valves found for this material and size
            </p>
          ) : (
            filteredValveParts.map((valve) => (
              <Card
                key={valve.id}
                className="cursor-pointer transition-all hover:shadow-md"
                onClick={() => handleValveSelect(valve.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                      {valve.imageUrl ? (
                        <Image
                          src={valve.imageUrl}
                          alt={valve.displayName}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-gray-400">
                          <svg
                            className="h-6 w-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium">{valve.displayName}</h4>
                      {valve.material && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          {valve.material}
                        </Badge>
                      )}
                      {valve.size && (
                        <Badge variant="outline" className="ml-1 mt-1 text-xs">
                          {valve.size}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


