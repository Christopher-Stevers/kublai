"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

interface AddSizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSizeCreated: (size: { nominal: number; unit: string; unitId: string }) => void;
  initialNominal?: number;
  initialUnit?: string;
}

export function AddSizeDialog({
  open,
  onOpenChange,
  onSizeCreated,
  initialNominal,
  initialUnit,
}: AddSizeDialogProps) {
  const utils = api.useUtils();
  const [sizeNominal, setSizeNominal] = useState(
    initialNominal?.toString() || "",
  );
  const [sizeUnitId, setSizeUnitId] = useState<string | null>(null);

  const { data: allUnits } = api.catalogue.getAllUnits.useQuery();

  // Find initial unit ID
  useEffect(() => {
    if (initialUnit && allUnits && !sizeUnitId) {
      const unit = allUnits.find((u) => u.code === initialUnit);
      if (unit) {
        setSizeUnitId(unit.id);
      }
    }
  }, [initialUnit, allUnits, sizeUnitId]);

  const createSize = api.catalogue.createSize.useMutation({
    onSuccess: (newSize) => {
      const unit = allUnits?.find((u) => u.id === newSize.unitId);
      if (unit) {
        onSizeCreated({
          nominal: parseFloat(newSize.nominal.toString()),
          unit: unit.code,
          unitId: newSize.unitId,
        });
      }
      setSizeNominal("");
      setSizeUnitId(null);
      onOpenChange(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!sizeNominal.trim() || !sizeUnitId) {
      return;
    }

    const nominal = parseFloat(sizeNominal.trim());
    if (isNaN(nominal)) {
      return;
    }

    createSize.mutate({
      nominal,
      unitId: sizeUnitId,
    });
  };

  const isLoading = createSize.isPending;
  const selectedUnit = allUnits?.find((u) => u.id === sizeUnitId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Size</DialogTitle>
          <DialogDescription>
            Create a new size combination that will be available for future part selections
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sizeNominal">
                  Size <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="sizeNominal"
                  type="number"
                  step="0.01"
                  value={sizeNominal}
                  onChange={(e) => setSizeNominal(e.target.value)}
                  placeholder="1.5"
                  required
                  disabled={isLoading}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="sizeUnit">
                  Unit <span className="text-red-500">*</span>
                </Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between mt-1"
                      disabled={isLoading}
                    >
                      {selectedUnit ? selectedUnit.code : "Select unit"}
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {allUnits?.map((unit) => (
                      <DropdownMenuItem
                        key={unit.id}
                        onClick={() => setSizeUnitId(unit.id)}
                      >
                        {unit.code}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !sizeNominal.trim() || !sizeUnitId}
            >
              {isLoading ? "Creating..." : "Create Size"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

