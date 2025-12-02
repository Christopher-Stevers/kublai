"use client";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";

interface BoardTypeSelectorProps {
  selectedBoardTypeId: string | null;
  numberOfBoards: number;
  onBoardTypeSelect: (boardTypeId: string) => void;
  onNumberOfBoardsChange: (count: number) => void;
  onNext: () => void;
}

export function BoardTypeSelector({
  selectedBoardTypeId,
  numberOfBoards,
  onBoardTypeSelect,
  onNumberOfBoardsChange,
  onNext,
}: BoardTypeSelectorProps) {
  const { data: boardTypes, isLoading } = api.board.getBoardTypes.useQuery();

  if (isLoading) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">Loading board types...</div>
      </div>
    );
  }

  if (!boardTypes || boardTypes.length === 0) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">No board types available</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Select Board Type
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {boardTypes.map((boardType) => (
            <Card
              key={boardType.id}
              className={cn(
                "cursor-pointer transition-colors",
                selectedBoardTypeId === boardType.id
                  ? "border-primary ring-2 ring-primary"
                  : "hover:border-primary/50"
              )}
              onClick={() => onBoardTypeSelect(boardType.id)}
            >
              <CardContent className="p-4">
                {boardType.imageUrl && (
                  <img
                    src={boardType.imageUrl}
                    alt={boardType.name}
                    className="mb-3 h-32 w-full rounded object-cover"
                  />
                )}
                <h3 className="font-semibold text-gray-900">{boardType.name}</h3>
                {boardType.description && (
                  <p className="mt-1 text-sm text-gray-600">
                    {boardType.description}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {selectedBoardTypeId && (
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Number of Boards
          </label>
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onNumberOfBoardsChange(Math.max(1, numberOfBoards - 1))}
            >
              -
            </Button>
            <span className="text-lg font-semibold text-gray-900">
              {numberOfBoards}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onNumberOfBoardsChange(numberOfBoards + 1)}
            >
              +
            </Button>
          </div>
        </div>
      )}

      {selectedBoardTypeId && (
        <Button onClick={onNext} className="w-full">
          Continue to Availability
        </Button>
      )}
    </div>
  );
}
