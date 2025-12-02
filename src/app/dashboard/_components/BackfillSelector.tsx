"use client";

import { useState } from "react";

interface BackfillPeriod {
  hours: number;
  startTime: Date;
  endTime: Date;
}

interface BackfillSelectorProps {
  selectedBackfills: BackfillPeriod[];
  onBackfillsChange: (backfills: BackfillPeriod[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export function BackfillSelector({
  selectedBackfills,
  onBackfillsChange,
  onBack,
  onNext,
}: BackfillSelectorProps) {
  const [hours, setHours] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const formatDateForInput = (date: Date) => {
    return date.toISOString().split("T")[0] ?? "";
  };

  const handleAddBackfill = () => {
    if (!startDate || !endDate || hours < 1) return;

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      alert("End date must be after start date");
      return;
    }

    const newBackfill: BackfillPeriod = {
      hours,
      startTime: start,
      endTime: end,
    };

    onBackfillsChange([...selectedBackfills, newBackfill]);
    setHours(1);
    setStartDate("");
    setEndDate("");
  };

  const handleRemoveBackfill = (index: number) => {
    onBackfillsChange(selectedBackfills.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Add Backfill Periods (Optional)
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          Backfills don't claim board time but are included in the order
        </p>

        {/* Add backfill form */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Hours
              </label>
              <input
                type="number"
                min="1"
                value={hours}
                onChange={(e) => setHours(Number.parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleAddBackfill}
                disabled={!startDate || !endDate || hours < 1}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* List of selected backfills */}
        {selectedBackfills.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              Selected Backfills ({selectedBackfills.length})
            </h3>
            <div className="space-y-2">
              {selectedBackfills.map((backfill, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="text-sm text-gray-900">
                    {backfill.startTime.toLocaleDateString()} -{" "}
                    {backfill.endTime.toLocaleDateString()} ({backfill.hours}{" "}
                    hours)
                  </div>
                  <button
                    onClick={() => handleRemoveBackfill(index)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800"
        >
          {selectedBackfills.length > 0 ? "Continue" : "Skip Backfills"}
        </button>
      </div>
    </div>
  );
}

