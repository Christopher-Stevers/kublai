"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface BoardFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  boardId?: string | null;
}

export function BoardForm({
  isOpen,
  onClose,
  onSuccess,
  boardId,
}: BoardFormProps) {
  const utils = api.useUtils();
  const { data: boardTypes } = api.board.getBoardTypes.useQuery();
  const { data: board } = api.admin.getBoard.useQuery(
    { boardId: boardId! },
    { enabled: !!boardId },
  );

  const createMutation = api.admin.createBoard.useMutation({
    onSuccess: () => {
      onSuccess();
    },
  });

  const updateMutation = api.admin.updateBoard.useMutation({
    onSuccess: () => {
      onSuccess();
    },
  });

  const [boardTypeId, setBoardTypeId] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleDescription, setVehicleDescription] = useState("");

  // Load board data when editing
  useEffect(() => {
    if (board && isOpen) {
      setBoardTypeId(board.boardType.id);
      setVehicleName(board.board.vehicleName ?? "");
      setVehicleDescription(board.board.vehicleDescription ?? "");
    } else if (!boardId && isOpen) {
      // Reset form for new board
      setBoardTypeId("");
      setVehicleName("");
      setVehicleDescription("");
    }
  }, [board, boardId, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!boardTypeId) {
      return;
    }

    const data = {
      boardTypeId,
      vehicleName: vehicleName.trim() || undefined,
      vehicleDescription: vehicleDescription.trim() || undefined,
    };

    if (boardId) {
      await updateMutation.mutateAsync({
        boardId,
        ...data,
      });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {boardId ? "Edit Board" : "Create Board"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Board Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Board Type <span className="text-red-500">*</span>
            </label>
            <select
              value={boardTypeId}
              onChange={(e) => setBoardTypeId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select a board type</option>
              {boardTypes?.map((bt) => (
                <option key={bt.id} value={bt.id}>
                  {bt.name}
                </option>
              ))}
            </select>
          </div>

          {/* Vehicle Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Name
            </label>
            <Input
              value={vehicleName}
              onChange={(e) => setVehicleName(e.target.value)}
              maxLength={255}
              placeholder="e.g., Service Truck Alpha"
            />
          </div>

          {/* Vehicle Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Description
            </label>
            <textarea
              value={vehicleDescription}
              onChange={(e) => setVehicleDescription(e.target.value)}
              className="w-full min-h-[80px] px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
              placeholder="Optional description of the vehicle"
            />
          </div>

          {/* Error Messages */}
          {createMutation.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">
                {createMutation.error.message}
              </p>
            </div>
          )}
          {updateMutation.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">
                {updateMutation.error.message}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading
                ? "Saving..."
                : boardId
                  ? "Update Board"
                  : "Create Board"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

