"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Plus, Edit, Trash2 } from "lucide-react";
import { BoardTypeForm } from "./BoardTypeForm";
import { DeleteBoardTypeDialog } from "./DeleteBoardTypeDialog";

function formatCurrency(amount: number): string {
  const formatter = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  });
  return formatter.format(amount / 100); // Convert cents to dollars
}

export function BoardTypesList() {
  const utils = api.useUtils();
  const { data: boardTypes, isLoading } = api.admin.getBoardTypes.useQuery();
  const [editingBoardType, setEditingBoardType] = useState<string | null>(null);
  const [deletingBoardType, setDeletingBoardType] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingBoardType(null);
    void utils.admin.getBoardTypes.invalidate();
  };

  const handleEdit = (boardTypeId: string) => {
    setEditingBoardType(boardTypeId);
    setIsFormOpen(true);
  };

  const handleDelete = (boardTypeId: string) => {
    setDeletingBoardType(boardTypeId);
  };

  const handleDeleteSuccess = () => {
    setDeletingBoardType(null);
    void utils.admin.getBoardTypes.invalidate();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-center text-gray-600">Loading board types...</p>
        </CardContent>
      </Card>
    );
  }

  if (!boardTypes || boardTypes.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Board Type
          </Button>
        </div>
        <Card>
          <CardContent className="p-8">
            <p className="text-center text-gray-600">No board types found.</p>
          </CardContent>
        </Card>
        <BoardTypeForm
          isOpen={isFormOpen}
          onClose={() => {
            setIsFormOpen(false);
            setEditingBoardType(null);
          }}
          onSuccess={handleFormSuccess}
          boardTypeId={editingBoardType}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Board Type
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {boardTypes.map((boardType) => (
          <Card key={boardType.id}>
            <CardContent className="p-4">
              {boardType.imageUrl && (
                <img
                  src={boardType.imageUrl}
                  alt={boardType.name}
                  className="mb-3 h-32 w-full rounded object-cover"
                />
              )}
              <div className="mb-2 flex items-start justify-between">
                <h3 className="font-semibold text-gray-900">{boardType.name}</h3>
                <Badge
                  variant={boardType.isAllocated ? "destructive" : "default"}
                  className="ml-2"
                >
                  {boardType.isAllocated ? "Allocated" : "Available"}
                </Badge>
              </div>
              {boardType.description && (
                <p className="mb-2 text-sm text-gray-600">{boardType.description}</p>
              )}
              <div className="mb-2 text-sm text-gray-600">
                {boardType.dimensionX && boardType.dimensionY ? (
                  <p>
                    Dimensions: {boardType.dimensionX} × {boardType.dimensionY}
                  </p>
                ) : (
                  <p className="text-gray-400">No dimensions set</p>
                )}
              </div>
              <div className="mb-2 text-sm text-gray-600">
                <p>Slot Cost: {formatCurrency(boardType.slotCostPerDay)}/day</p>
                <p>Backfill Cost: {formatCurrency(boardType.backfillCostPerDay)}/day</p>
              </div>
              <div className="mb-2 text-sm text-gray-600">
                <p>Boards: {boardType.boardsCount}</p>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleEdit(boardType.id)}
                  disabled={boardType.isAllocated}
                >
                  <Edit className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(boardType.id)}
                  disabled={boardType.isAllocated || boardType.boardsCount > 0}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <BoardTypeForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingBoardType(null);
        }}
        onSuccess={handleFormSuccess}
        boardTypeId={editingBoardType}
      />

      {deletingBoardType && (
        <DeleteBoardTypeDialog
          boardTypeId={deletingBoardType}
          onClose={() => setDeletingBoardType(null)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}

