"use client";

import { api } from "~/trpc/react";

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
            <button
              key={boardType.id}
              onClick={() => onBoardTypeSelect(boardType.id)}
              className={`rounded-lg border-2 p-4 text-left transition-colors ${
                selectedBoardTypeId === boardType.id
                  ? "border-gray-900 bg-gray-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
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
            </button>
          ))}
        </div>
      </div>

      {selectedBoardTypeId && (
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Number of Boards
          </label>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNumberOfBoardsChange(Math.max(1, numberOfBoards - 1))}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              -
            </button>
            <span className="text-lg font-semibold text-gray-900">
              {numberOfBoards}
            </span>
            <button
              type="button"
              onClick={() => onNumberOfBoardsChange(numberOfBoards + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              +
            </button>
          </div>
        </div>
      )}

      {selectedBoardTypeId && (
        <button
          onClick={onNext}
          className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800"
        >
          Continue to Availability
        </button>
      )}
    </div>
  );
}

