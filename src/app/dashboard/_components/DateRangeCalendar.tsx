"use client";

import { useState } from "react";
import { getStartOfDay, getStartOfNextDay } from "~/lib/date-utils";

interface DateRangeCalendarProps {
  availableBoards?: number;
  onDateRangeSelected: (startDate: Date, endDate: Date) => void;
  onBack: () => void;
}

export function DateRangeCalendar({
  availableBoards,
  onDateRangeSelected,
  onBack,
}: DateRangeCalendarProps) {
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Allow selecting any date range (no pre-filtered slots)
  const minDate = new Date();
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1); // Allow up to 1 year in future

  const formatDateForInput = (date: Date) => {
    return date.toISOString().split("T")[0] ?? "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start <= end) {
        // Normalize dates: start to beginning of day, end to start of next day
        // This ensures exactly 24 hours for single day selections
        const normalizedStart = getStartOfDay(start);
        const normalizedEnd = getStartOfNextDay(end);
        onDateRangeSelected(normalizedStart, normalizedEnd);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Select Date Range
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          Choose your desired date range for the booking
        </p>
        {availableBoards !== undefined && (
          <p className="mb-4 text-sm text-gray-600">
            {availableBoards > 0
              ? `${availableBoards} boards available`
              : "No boards available for selected period"}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={formatDateForInput(minDate)}
              max={formatDateForInput(maxDate)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || formatDateForInput(minDate)}
              max={formatDateForInput(maxDate)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              required
            />
          </div>

          {startDate && endDate && new Date(startDate) > new Date(endDate) && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              End date must be after start date
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="button"
              onClick={onBack}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={!startDate || !endDate || new Date(startDate) > new Date(endDate)}
              className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

