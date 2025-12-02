"use client";

import { useState } from "react";
import { type DateRange } from "react-day-picker";
import { BoardDateSelector } from "./_components/BoardDateSelector";
import { CreativeSelector } from "./_components/CreativeSelector";
import { UrlInput } from "./_components/UrlInput";
import { BackfillSelector } from "./_components/BackfillSelector";
import { ConfirmOrderModal } from "./_components/ConfirmOrderModal";
import { OrderRow } from "./_components/OrderRow";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { normalizeDateRangeForDisplay, normalizeDateRangeForUse } from "~/lib/date-utils";

type Step = "board" | "creative" | "url" | "backfill" | "confirm";

interface BackfillPeriod {
  hours: number;
  startTime: Date;
  endTime: Date;
}

type SortBy = "date" | "status";
type SortOrder = "asc" | "desc";

export default function Dashboard() {
  const [currentStep, setCurrentStep] = useState<Step>("board");
  const [selectedBoardTypeId, setSelectedBoardTypeId] = useState<string | null>(
    null,
  );
  const [numberOfBoards, setNumberOfBoards] = useState(1);
  const [selectedDateRange, setSelectedDateRange] = useState<DateRange | undefined>(undefined);
  const [selectedCreativeIds, setSelectedCreativeIds] = useState<string[]>(
    [],
  );
  const [targetUrl, setTargetUrl] = useState<string>("");
  const [utmTag, setUtmTag] = useState<string>("");
  const [selectedBackfills, setSelectedBackfills] = useState<BackfillPeriod[]>(
    [],
  );
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Orders section state
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersSortBy, setOrdersSortBy] = useState<SortBy>("date");
  const [ordersSortOrder, setOrdersSortOrder] = useState<SortOrder>("desc");

  // Fetch board type name for confirmation modal
  const { data: boardTypes } = api.board.getBoardTypes.useQuery();
  const selectedBoardType = boardTypes?.find(
    (bt) => bt.id === selectedBoardTypeId,
  );

  // Fetch user orders
  const utils = api.useUtils();
  const { data: ordersData, isLoading: isLoadingOrders } =
    api.board.getUserOrders.useQuery({
      page: ordersPage,
      pageSize: 10,
      sortBy: ordersSortBy,
      sortOrder: ordersSortOrder,
    });

  // Create order mutation
  const createOrderMutation = api.board.createOrder.useMutation({
    onSuccess: () => {
      void utils.board.getUserOrders.invalidate();
    },
  });

  // Fetch user's creatives to check approval status
  const { data: myCreatives } = api.creative.getMyCreatives.useQuery();
  const selectedCreatives = myCreatives?.filter((c) =>
    selectedCreativeIds.includes(c.id),
  ) ?? [];
  
  // Check if all creatives in the order are approved by admin
  // A creative is approved if: approved === true AND approvedBy is not null AND approvedAt is not null
  // All selected creatives must be approved
  const allCreativesApproved =
    selectedCreativeIds.length === 0 ||
    selectedCreatives.every(
      (creative) =>
        creative.approved === true &&
        creative.approvedBy !== null &&
        creative.approvedAt !== null,
    );

  const handleDateRangeChange = (range: DateRange | undefined) => {
    // Normalize for display - keeps single-day selections as same day for calendar
    const normalizedRange = normalizeDateRangeForDisplay(range);
    setSelectedDateRange(normalizedRange);
  };

  const handleBoardDateNext = () => {
    if (selectedBoardTypeId && selectedDateRange?.from && selectedDateRange?.to) {
      setCurrentStep("creative");
    }
  };

  const handleCreativeNext = () => {
    setCurrentStep("url");
  };

  const handleBackfillNext = () => {
    setIsConfirmModalOpen(true);
  };

  // Calculate price on frontend (matches backend calculation)
  const calculateTotalPrice = (): number => {
    if (!selectedBoardType || !selectedDateRange?.from || !selectedDateRange?.to) return 0;

    // Normalize date range for use (ensures proper 24-hour boundaries)
    const normalizedRange = normalizeDateRangeForUse(selectedDateRange);
    if (!normalizedRange.from || !normalizedRange.to) return 0;

    const slotCostPerDay = selectedBoardType.slotCostPerDay ?? 0;
    const backfillCostPerDay = selectedBoardType.backfillCostPerDay ?? 0;

    let total = 0;

    // Calculate slot cost: number of slots * cost per day * number of days
    const slotDays = Math.ceil(
      (normalizedRange.to.getTime() - normalizedRange.from.getTime()) /
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
    if (!selectedBoardTypeId || !selectedDateRange?.from || !selectedDateRange?.to || numberOfBoards < 1) {
      return;
    }

    try {
      // Normalize date range for use (ensures proper 24-hour boundaries)
      const normalizedRange = normalizeDateRangeForUse(selectedDateRange);
      if (!normalizedRange.from || !normalizedRange.to) {
        return;
      }

      // Create slots array - one slot per vehicle for the selected time period
      const slots = Array.from({ length: numberOfBoards }, () => ({
        startTime: normalizedRange.from!,
        endTime: normalizedRange.to!,
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
        creativeIds: selectedCreativeIds.length > 0 ? selectedCreativeIds : undefined,
        allCreativesApproved,
        targetUrl: targetUrl && targetUrl.trim() !== "" ? targetUrl : undefined,
        utmTag: utmTag && utmTag.trim() !== "" ? utmTag : undefined,
      });

      setIsConfirmModalOpen(false);
      // TODO: Show success message or navigate to success page
      // Reset form
      setCurrentStep("board");
      setSelectedBoardTypeId(null);
      setNumberOfBoards(1);
      setSelectedDateRange(undefined);
      setSelectedCreativeIds([]);
      setTargetUrl("");
      setUtmTag("");
      setSelectedBackfills([]);
    } catch (error) {
      // Error handling is done by tRPC
      console.error("Failed to create order:", error);
    }
  };

  const handleOrdersSort = (field: SortBy) => {
    if (ordersSortBy === field) {
      // Toggle sort order
      setOrdersSortOrder(ordersSortOrder === "asc" ? "desc" : "asc");
    } else {
      // Set new sort field
      setOrdersSortBy(field);
      setOrdersSortOrder("desc");
    }
    setOrdersPage(1); // Reset to first page when sorting changes
  };

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-8 text-3xl font-bold text-gray-900">Dashboard</h1>

        <div className="rounded-lg bg-white p-8 shadow-sm">
          {currentStep === "board" && (
            <BoardDateSelector
              selectedBoardTypeId={selectedBoardTypeId}
              numberOfBoards={numberOfBoards}
              dateRange={selectedDateRange}
              onBoardTypeSelect={setSelectedBoardTypeId}
              onNumberOfBoardsChange={setNumberOfBoards}
              onDateRangeChange={handleDateRangeChange}
              onNext={handleBoardDateNext}
            />
          )}

          {currentStep === "creative" && (
            <CreativeSelector
              selectedCreativeIds={selectedCreativeIds}
              onCreativeAdd={(creativeId) => {
                if (!selectedCreativeIds.includes(creativeId) && selectedCreativeIds.length < 5) {
                  setSelectedCreativeIds([...selectedCreativeIds, creativeId]);
                }
              }}
              onCreativeRemove={(creativeId) => {
                setSelectedCreativeIds(selectedCreativeIds.filter((id) => id !== creativeId));
              }}
              onBack={() => setCurrentStep("board")}
              onNext={handleCreativeNext}
            />
          )}

          {currentStep === "url" && (
            <UrlInput
              targetUrl={targetUrl}
              utmTag={utmTag}
              onTargetUrlChange={setTargetUrl}
              onUtmTagChange={setUtmTag}
              onBack={() => setCurrentStep("creative")}
              onNext={() => setCurrentStep("backfill")}
            />
          )}

          {currentStep === "backfill" && (
            <BackfillSelector
              selectedBackfills={selectedBackfills}
              onBackfillsChange={setSelectedBackfills}
              onBack={() => setCurrentStep("url")}
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
            startDate: selectedDateRange?.from ?? null,
            endDate: selectedDateRange?.to ?? null,
            creatives: selectedCreatives.map((c) => ({
              id: c.id,
              fileName: c.fileName,
              fileType: c.fileType,
              filePath: c.filePath,
              userId: c.userId,
            })),
            totalPrice: calculateTotalPrice(),
            backfillCount: selectedBackfills.length,
            targetUrl: targetUrl && targetUrl.trim() !== "" ? targetUrl : undefined,
            utmTag: utmTag && utmTag.trim() !== "" ? utmTag : undefined,
          }}
        />

        {/* Orders Section */}
        <div className="mt-12">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">My Orders</h2>
          </div>

          {isLoadingOrders ? (
            <Card>
              <CardContent className="p-8">
                <p className="text-center text-gray-600">Loading orders...</p>
              </CardContent>
            </Card>
          ) : !ordersData || ordersData.orders.length === 0 ? (
            <Card>
              <CardContent className="p-8">
                <div className="flex flex-col items-center justify-center">
                  <p className="text-gray-600">No orders yet.</p>
                  <p className="mt-2 text-sm text-gray-500">
                    Create your first order above.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Sort Controls */}
              <div className="mb-4 flex items-center gap-4">
                <span className="text-sm text-gray-600">Sort by:</span>
                <button
                  onClick={() => handleOrdersSort("date")}
                  className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  Date
                  {ordersSortBy === "date" ? (
                    ordersSortOrder === "asc" ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  ) : (
                    <ArrowUpDown className="h-4 w-4 opacity-50" />
                  )}
                </button>
                <button
                  onClick={() => handleOrdersSort("status")}
                  className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  Status
                  {ordersSortBy === "status" ? (
                    ordersSortOrder === "asc" ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  ) : (
                    <ArrowUpDown className="h-4 w-4 opacity-50" />
                  )}
                </button>
              </div>

              {/* Orders List */}
              <div className="space-y-3">
                {ordersData.orders.map((item) => (
                  <OrderRow
                    key={item.order.id}
                    order={item.order}
                    slots={item.slots}
                    backfills={item.backfills}
                    preview={item.preview}
                    startDate={item.startDate}
                    endDate={item.endDate}
                  />
                ))}
              </div>

              {/* Pagination */}
              {ordersData.pagination.totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-700">
                    Showing{" "}
                    {Math.min(
                      (ordersData.pagination.page - 1) *
                        ordersData.pagination.pageSize +
                        1,
                      ordersData.pagination.totalCount,
                    )}{" "}
                    to{" "}
                    {Math.min(
                      ordersData.pagination.page *
                        ordersData.pagination.pageSize,
                      ordersData.pagination.totalCount,
                    )}{" "}
                    of {ordersData.pagination.totalCount} orders
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                      disabled={ordersPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from(
                        { length: ordersData.pagination.totalPages },
                        (_, i) => i + 1,
                      )
                        .filter(
                          (page) =>
                            page === 1 ||
                            page === ordersData.pagination.totalPages ||
                            Math.abs(page - ordersPage) <= 1,
                        )
                        .map((page, idx, arr) => (
                          <div key={page} className="flex items-center gap-1">
                            {idx > 0 && arr[idx - 1] !== page - 1 && (
                              <span className="px-2 text-gray-500">...</span>
                            )}
                            <Button
                              variant={ordersPage === page ? "default" : "outline"}
                              size="sm"
                              onClick={() => setOrdersPage(page)}
                              className="min-w-[2.5rem]"
                            >
                              {page}
                            </Button>
                          </div>
                        ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setOrdersPage((p) =>
                          Math.min(ordersData.pagination.totalPages, p + 1),
                        )
                      }
                      disabled={ordersPage === ordersData.pagination.totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
