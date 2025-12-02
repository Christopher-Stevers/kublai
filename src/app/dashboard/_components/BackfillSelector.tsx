"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { getStartOfDay, getStartOfNextDay } from "~/lib/date-utils";

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

    if (start > end) {
      alert("End date must be after or equal to start date");
      return;
    }

    // Normalize dates: start to beginning of day, end to start of next day
    // This ensures consistent date boundaries
    const normalizedStart = getStartOfDay(start);
    const normalizedEnd = getStartOfNextDay(end);

    const newBackfill: BackfillPeriod = {
      hours,
      startTime: normalizedStart,
      endTime: normalizedEnd,
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
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Hours
                </label>
                <Input
                  type="number"
                  min="1"
                  value={hours}
                  onChange={(e) => setHours(Number.parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  End Date
                </label>
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleAddBackfill}
                  disabled={!startDate || !endDate || hours < 1}
                  className="w-full"
                >
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* List of selected backfills */}
        {selectedBackfills.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              Selected Backfills ({selectedBackfills.length})
            </h3>
            <div className="space-y-2">
              {selectedBackfills.map((backfill, index) => (
                <Card key={index}>
                  <CardContent className="flex items-center justify-between p-3">
                    <div className="text-sm text-gray-900">
                      {backfill.startTime.toLocaleDateString()} -{" "}
                      {backfill.endTime.toLocaleDateString()} ({backfill.hours}{" "}
                      hours)
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveBackfill(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={onNext} className="flex-1">
          {selectedBackfills.length > 0 ? "Continue" : "Skip Backfills"}
        </Button>
      </div>
    </div>
  );
}
