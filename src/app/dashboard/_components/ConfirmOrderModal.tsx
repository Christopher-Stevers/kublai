"use client";

interface ConfirmOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  orderDetails: {
    boardTypeName?: string;
    numberOfBoards: number;
    startDate: Date | null;
    endDate: Date | null;
    creativeFileName?: string;
    totalPrice?: number; // in cents
    backfillCount?: number;
  };
}

export function ConfirmOrderModal({
  isOpen,
  onClose,
  onConfirm,
  orderDetails,
}: ConfirmOrderModalProps) {
  if (!isOpen) return null;

  const formatDate = (date: Date | null) => {
    if (!date) return "Not selected";
    return new Date(date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">
          Confirm Order
        </h2>

        <div className="mb-6 space-y-4">
          <div>
            <span className="text-sm font-medium text-gray-600">
              Board Type:
            </span>
            <p className="text-gray-900">
              {orderDetails.boardTypeName || "Not selected"}
            </p>
          </div>

          <div>
            <span className="text-sm font-medium text-gray-600">
              Number of Boards:
            </span>
            <p className="text-gray-900">{orderDetails.numberOfBoards}</p>
          </div>

          <div>
            <span className="text-sm font-medium text-gray-600">
              Date Range:
            </span>
            <p className="text-gray-900">
              {formatDate(orderDetails.startDate)} -{" "}
              {formatDate(orderDetails.endDate)}
            </p>
          </div>

          <div>
            <span className="text-sm font-medium text-gray-600">Creative:</span>
            <p className="text-gray-900">
              {orderDetails.creativeFileName || "Not selected"}
            </p>
          </div>

          {orderDetails.backfillCount !== undefined && orderDetails.backfillCount > 0 && (
            <div>
              <span className="text-sm font-medium text-gray-600">
                Backfill Periods:
              </span>
              <p className="text-gray-900">{orderDetails.backfillCount}</p>
            </div>
          )}

          {orderDetails.totalPrice !== undefined && (
            <div className="border-t border-gray-200 pt-4">
              <div className="flex justify-between">
                <span className="text-lg font-semibold text-gray-900">
                  Total Price:
                </span>
                <span className="text-lg font-bold text-gray-900">
                  ${(orderDetails.totalPrice / 100).toFixed(2)} CAD
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800"
          >
            Confirm Order
          </button>
        </div>
      </div>
    </div>
  );
}

