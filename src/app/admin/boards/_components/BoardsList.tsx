"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Plus, Edit, Trash2 } from "lucide-react";
import { BoardForm } from "./BoardForm";
import { DeleteBoardDialog } from "./DeleteBoardDialog";

export function BoardsList() {
  const utils = api.useUtils();
  const [page, setPage] = useState(1);
  const [boardTypeFilter, setBoardTypeFilter] = useState<string | undefined>(
    undefined,
  );
  const { data: boardTypes } = api.board.getBoardTypes.useQuery();
  const { data: boardsData, isLoading } = api.admin.getBoards.useQuery({
    boardTypeId: boardTypeFilter,
    page,
    pageSize: 20,
  });

  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [deletingBoard, setDeletingBoard] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingBoard(null);
    void utils.admin.getBoards.invalidate();
  };

  const handleEdit = (boardId: string) => {
    setEditingBoard(boardId);
    setIsFormOpen(true);
  };

  const handleDelete = (boardId: string) => {
    setDeletingBoard(boardId);
  };

  const handleDeleteSuccess = () => {
    setDeletingBoard(null);
    void utils.admin.getBoards.invalidate();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <p className="text-center text-gray-600">Loading boards...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">
            Filter by Board Type:
          </label>
          <select
            value={boardTypeFilter ?? ""}
            onChange={(e) => {
              setBoardTypeFilter(e.target.value || undefined);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="">All Board Types</option>
            {boardTypes?.map((bt) => (
              <option key={bt.id} value={bt.id}>
                {bt.name}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Board
        </Button>
      </div>

      {!boardsData || boardsData.boards.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <p className="text-center text-gray-600">No boards found.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                    Vehicle Name
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                    Board Type
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {boardsData.boards.map(({ board, boardType, isAllocated }) => (
                  <tr key={board.id} className="border-b border-gray-100">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {board.vehicleName || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {boardType.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {board.vehicleDescription || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={isAllocated ? "destructive" : "default"}
                      >
                        {isAllocated ? "Allocated" : "Available"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(board.id)}
                          disabled={isAllocated}
                        >
                          <Edit className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(board.id)}
                          disabled={isAllocated}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {boardsData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing{" "}
                {Math.min(
                  (boardsData.pagination.page - 1) *
                    boardsData.pagination.pageSize +
                    1,
                  boardsData.pagination.totalCount,
                )}{" "}
                to{" "}
                {Math.min(
                  boardsData.pagination.page *
                    boardsData.pagination.pageSize,
                  boardsData.pagination.totalCount,
                )}{" "}
                of {boardsData.pagination.totalCount} boards
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((p) =>
                      Math.min(boardsData.pagination.totalPages, p + 1),
                    )
                  }
                  disabled={page === boardsData.pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <BoardForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingBoard(null);
        }}
        onSuccess={handleFormSuccess}
        boardId={editingBoard}
      />

      {deletingBoard && (
        <DeleteBoardDialog
          boardId={deletingBoard}
          onClose={() => setDeletingBoard(null)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}

