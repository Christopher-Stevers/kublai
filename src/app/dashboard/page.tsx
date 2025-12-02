"use client";

import { useState } from "react";
import { BoardTypeSelector } from "./_components/BoardTypeSelector";
import { AvailabilityView } from "./_components/AvailabilityView";
import { DateRangeCalendar } from "./_components/DateRangeCalendar";
import { CreativeSelector } from "./_components/CreativeSelector";
import { BackfillSelector } from "./_components/BackfillSelector";
import { ConfirmOrderModal } from "./_components/ConfirmOrderModal";
import { api } from "~/trpc/react";

type Step = "board" | "availability" | "dateRange" | "creative" | "backfill" | "confirm";

interface BackfillPeriod {
  hours: number;
  startTime: Date;
  endTime: Date;
}

export default function Dashboard() {
  const [currentStep, setCurrentStep] = useState<Step>("board");
  const [selectedBoardTypeId, setSelectedBoardTypeId] = useState<string | null>(
    null,
  );
  const [numberOfBoards, setNumberOfBoards] = useState(1);
  const [selectedDateRange, setSelectedDateRange] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [selectedCreativeId, setSelectedCreativeId] = useState<string | null>(
    null,
  );
  const [selectedBackfills, setSelectedBackfills] = useState<BackfillPeriod[]>(
    [],
  );
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Fetch board type name for confirmation modal
  const { data: boardTypes } = api.board.getBoardTypes.useQuery();
  const selectedBoardType = boardTypes?.find(
    (bt) => bt.id === selectedBoardTypeId,
  );

  // Fetch availability for availability view (used by AvailabilityView component)
  api.board.getAvailability.useQuery(
    {
      boardTypeId: selectedBoardTypeId ?? "",
    },
    {
      enabled: !!selectedBoardTypeId && currentStep === "availability",
    },
  );

  // Check availability for selected date range
  const { data: dateRangeAvailability } = api.board.getAvailability.useQuery(
    {
      boardTypeId: selectedBoardTypeId ?? "",
      startTime: selectedDateRange?.start,
      endTime: selectedDateRange?.end,
    },
    {
      enabled: !!selectedBoardTypeId && !!selectedDateRange && currentStep === "dateRange",
    },
  );

  // Create order mutation
  const createOrderMutation = api.board.createOrder.useMutation();

  // Fetch creative name for confirmation modal
  const { data: creatives } = api.creative.getAll.useQuery();
  const selectedCreative = creatives?.find((c) => c.id === selectedCreativeId);

  const handleBoardTypeSelect = (boardTypeId: string) => {
    setSelectedBoardTypeId(boardTypeId);
  };

  const handleAvailabilityNext = () => {
    setCurrentStep("dateRange");
  };

  const handleDateRangeSelected = (startDate: Date, endDate: Date) => {
    setSelectedDateRange({ start: startDate, end: endDate });
    setCurrentStep("creative");
  };

  const handleCreativeNext = () => {
    setCurrentStep("backfill");
  };

  const handleBackfillNext = () => {
    setIsConfirmModalOpen(true);
  };

  // Calculate price on frontend (matches backend calculation)
  const calculateTotalPrice = (): number => {
    if (!selectedBoardType || !selectedDateRange) return 0;

    const slotCostPerDay = selectedBoardType.slotCostPerDay ?? 0;
    const backfillCostPerDay = selectedBoardType.backfillCostPerDay ?? 0;

    let total = 0;

    // Calculate slot cost: number of slots * cost per day * number of days
    const slotDays = Math.ceil(
      (selectedDateRange.end.getTime() - selectedDateRange.start.getTime()) /
        (1000 * 60 * 60 * 24),
    );
    total += numberOfBoards * slotCostPerDay * slotDays;

    // Calculate backfill cost: number of backfills * cost per day * number of days per backfill
    for (const backfill of selectedBackfills) {
      const backfillDays = Math.ceil(
        (backfill.endTime.getTime() - backfill.startTime.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      total += backfillCostPerDay * backfillDays;
    }

    return total;
  };

  const handleConfirmOrder = async () => {
    if (!selectedBoardTypeId || !selectedDateRange || numberOfBoards < 1) {
      return;
    }

    try {
      // Create slots array - one slot per vehicle for the selected time period
      const slots = Array.from({ length: numberOfBoards }, () => ({
        startTime: selectedDateRange.start,
        endTime: selectedDateRange.end,
      }));

      // Convert backfills to the format expected by the API
      const backfills = selectedBackfills.map((bf) => ({
        hours: bf.hours,
        startTime: bf.startTime,
        endTime: bf.endTime,
      }));

      await createOrderMutation.mutateAsync({
        boardTypeId: selectedBoardTypeId,
        slots,
        backfills: backfills.length > 0 ? backfills : undefined,
        creativeId: selectedCreativeId ?? undefined,
      });

      setIsConfirmModalOpen(false);
      // TODO: Show success message or navigate to success page
      // Reset form
      setCurrentStep("board");
      setSelectedBoardTypeId(null);
      setNumberOfBoards(1);
      setSelectedDateRange(null);
      setSelectedCreativeId(null);
      setSelectedBackfills([]);
    } catch (error) {
      // Error handling is done by tRPC
      console.error("Failed to create order:", error);
    }
  };

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-8 text-3xl font-bold text-gray-900">Dashboard</h1>

        <div className="rounded-lg bg-white p-8 shadow-sm">
          {currentStep === "board" && (
            <BoardTypeSelector
              selectedBoardTypeId={selectedBoardTypeId}
              numberOfBoards={numberOfBoards}
              onBoardTypeSelect={handleBoardTypeSelect}
              onNumberOfBoardsChange={setNumberOfBoards}
              onNext={() => setCurrentStep("availability")}
            />
          )}

          {currentStep === "availability" && selectedBoardTypeId && (
            <AvailabilityView
              boardTypeId={selectedBoardTypeId}
              onBack={() => setCurrentStep("board")}
              onDateRangeSelect={handleAvailabilityNext}
            />
          )}

          {currentStep === "dateRange" && (
            <DateRangeCalendar
              availableBoards={dateRangeAvailability?.availableBoards}
              onDateRangeSelected={handleDateRangeSelected}
              onBack={() => setCurrentStep("availability")}
            />
          )}

          {currentStep === "creative" && (
            <CreativeSelector
              selectedCreativeId={selectedCreativeId}
              onCreativeSelect={setSelectedCreativeId}
              onBack={() => setCurrentStep("dateRange")}
              onNext={handleCreativeNext}
            />
          )}

          {currentStep === "backfill" && (
            <BackfillSelector
              selectedBackfills={selectedBackfills}
              onBackfillsChange={setSelectedBackfills}
              onBack={() => setCurrentStep("creative")}
              onNext={handleBackfillNext}
            />
          )}
        </div>

        <ConfirmOrderModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          onConfirm={handleConfirmOrder}
          orderDetails={{
            boardTypeName: selectedBoardType?.name,
            numberOfBoards,
            startDate: selectedDateRange?.start ?? null,
            endDate: selectedDateRange?.end ?? null,
            creativeFileName: selectedCreative?.fileName,
            totalPrice: calculateTotalPrice(),
            backfillCount: selectedBackfills.length,
          }}
        />
      </div>
    </div>
  );
}
