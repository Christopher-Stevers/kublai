"use client";

import { useState } from "react";
import { Calendar } from "~/components/ui/calendar";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { api } from "~/trpc/react";
import { type DateRange } from "react-day-picker";
import { cn } from "~/lib/utils";
import { normalizeDateRangeForUse } from "~/lib/date-utils";

interface BoardDateSelectorProps {
  selectedBoardTypeId: string | null;
  numberOfBoards: number;
  dateRange: DateRange | undefined;
  onBoardTypeSelect: (boardTypeId: string) => void;
  onNumberOfBoardsChange: (count: number) => void;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onNext: () => void;
}

export function BoardDateSelector({
  selectedBoardTypeId,
  numberOfBoards,
  dateRange,
  onBoardTypeSelect,
  onNumberOfBoardsChange,
  onDateRangeChange,
  onNext,
}: BoardDateSelectorProps) {
  const { data: boardTypes, isLoading: boardTypesLoading } =
    api.board.getBoardTypes.useQuery();

  // Normalize date range for availability query (ensures proper 24-hour boundaries)
  const normalizedRangeForQuery = dateRange?.from && dateRange?.to
    ? normalizeDateRangeForUse(dateRange)
    : undefined;

  // Fetch availability when date range is selected
  const { data: availability, isLoading: availabilityLoading } =
    api.board.getAvailability.useQuery(
      {
        boardTypeId: selectedBoardTypeId ?? "",
        startTime: normalizedRangeForQuery?.from,
        endTime: normalizedRangeForQuery?.to,
      },
      {
        enabled:
          !!selectedBoardTypeId &&
          !!normalizedRangeForQuery?.from &&
          !!normalizedRangeForQuery?.to,
      },
    );

  const availableBoards = availability?.availableBoards ?? 0;
  const canProceed =
    selectedBoardTypeId &&
    dateRange?.from &&
    dateRange?.to &&
    numberOfBoards > 0 &&
    numberOfBoards <= availableBoards;

  if (boardTypesLoading) {
    return (
      <div className="text-center text-gray-600">Loading board types...</div>
    );
  }

  if (!boardTypes || boardTypes.length === 0) {
    return (
      <div className="text-center text-gray-600">No board types available</div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Board Type Selection */}
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

      {/* Date Range Selection */}
      {selectedBoardTypeId && (
        <div>
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            Select Date Range
          </h2>
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex justify-center">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={onDateRangeChange}
                numberOfMonths={2}
                disabled={(date) => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  return date < today;
                }}
                className="rounded-lg border border-gray-200"
              />
            </div>

            {/* Availability Info */}
            <div className="flex flex-col justify-center space-y-4">
              {dateRange?.from && !dateRange?.to && (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-gray-600">
                      Select an end date to see availability
                    </p>
                  </CardContent>
                </Card>
              )}
              {dateRange?.from && dateRange?.to ? (
                <>
                  {availabilityLoading ? (
                    <div className="text-sm text-gray-600">
                      Checking availability...
                    </div>
                  ) : (
                    <>
                      <Card>
                        <CardContent className="p-6">
                          <div className="space-y-3">
                            <div className="flex justify-between">
                              <span className="text-sm font-medium text-gray-700">
                                Total Boards:
                              </span>
                              <span className="text-sm text-gray-900">
                                {availability?.totalBoards ?? 0}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm font-medium text-gray-700">
                                Available Boards:
                              </span>
                              <span
                                className={cn(
                                  "text-sm font-semibold",
                                  availableBoards > 0
                                    ? "text-green-600"
                                    : "text-red-600"
                                )}
                              >
                                {availableBoards}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm font-medium text-gray-700">
                                Booked Boards:
                              </span>
                              <span className="text-sm text-gray-900">
                                {availability?.bookedBoards ?? 0}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {availableBoards === 0 && (
                        <Card className="border-red-200 bg-red-50">
                          <CardContent className="p-3">
                            <p className="text-center text-sm text-red-600">
                              No boards available for the selected date range
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      {availableBoards > 0 && (
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">
                            Number of Boards
                          </label>
                          <div className="flex items-center gap-4">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                onNumberOfBoardsChange(
                                  Math.max(1, numberOfBoards - 1),
                                )
                              }
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
                              onClick={() =>
                                onNumberOfBoardsChange(
                                  Math.min(availableBoards, numberOfBoards + 1),
                                )
                              }
                              disabled={numberOfBoards >= availableBoards}
                            >
                              +
                            </Button>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">
                            Maximum: {availableBoards} boards
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-gray-600">
                      Select a date range to see availability
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Continue Button */}
      {selectedBoardTypeId && (
        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!canProceed}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
