"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface DeleteBoardTypeDialogProps {
  boardTypeId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteBoardTypeDialog({
  boardTypeId,
  onClose,
  onSuccess,
}: DeleteBoardTypeDialogProps) {
  const utils = api.useUtils();
  const { data: boardType } = api.admin.getBoardType.useQuery({
    boardTypeId,
  });

  const deleteMutation = api.admin.deleteBoardType.useMutation({
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ boardTypeId });
    } catch (error) {
      // Error is handled by mutation error state
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Board Type</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this board type? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>

        {boardType && (
          <div className="space-y-4">
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-yellow-900">
                    Board Type: {boardType.name}
                  </p>
                  {boardType.boardsCount > 0 && (
                    <p className="text-sm text-yellow-700 mt-1">
                      This board type has {boardType.boardsCount} board(s)
                      associated with it. You must remove or reassign all
                      boards before deleting this type.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {deleteMutation.error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-700">
                  {deleteMutation.error.message}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending || boardType.boardsCount > 0}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

