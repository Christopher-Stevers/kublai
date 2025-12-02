"use client";

import { api } from "~/trpc/react";

interface AvailabilityViewProps {
  boardTypeId: string;
  onBack: () => void;
  onDateRangeSelect: () => void;
}

export function AvailabilityView({
  boardTypeId,
  onBack,
  onDateRangeSelect,
}: AvailabilityViewProps) {
  const { data: availability, isLoading } = api.board.getAvailability.useQuery(
    { boardTypeId },
    { enabled: !!boardTypeId },
  );

  if (isLoading) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">Loading availability...</div>
      </div>
    );
  }

  if (!availability) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">
          No availability data found
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Board Availability
        </h2>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-700">
                Total Boards:
              </span>
              <span className="text-sm text-gray-900">
                {availability.totalBoards}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-700">
                Available Boards:
              </span>
              <span className="text-sm font-semibold text-green-600">
                {availability.availableBoards}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-700">
                Booked Boards:
              </span>
              <span className="text-sm text-gray-900">
                {availability.bookedBoards}
              </span>
            </div>
          </div>

          {availability.availableBoards === 0 && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-center text-sm text-red-600">
              Sold out - No boards available for this type
            </div>
          )}

          {availability.availableBoards > 0 && (
            <div className="mt-4 text-center text-sm text-gray-600">
              {availability.availableBoards} out of {availability.totalBoards}{" "}
              boards available
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Back
        </button>
        {availability.availableBoards > 0 && (
          <button
            onClick={onDateRangeSelect}
            className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800"
          >
            Select Date Range
          </button>
        )}
      </div>
    </div>
  );
}

