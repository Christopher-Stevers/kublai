"use client";

import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ChevronDown, ChevronRight, Calendar, Clock } from "lucide-react";
import { formatDateRange } from "~/lib/date-utils";

function formatCurrency(amount: number, currency: string = "cad"): string {
  const formatter = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return formatter.format(amount / 100); // Convert cents to dollars
}

interface Slot {
  id: string;
  startTime: Date;
  endTime: Date;
  board: {
    id: string;
    vehicleName: string | null;
    boardType: {
      id: string;
      name: string;
    };
  };
}

interface Backfill {
  id: string;
  hours: number;
  startTime: Date;
  endTime: Date;
}

interface Preview {
  url: string;
  fileType: string | null;
  fileName: string | null;
}

interface OrderRowProps {
  order: {
    id: string;
    status: string | null;
    totalPrice: number;
    currency: string | null;
    approved: boolean | null;
  };
  slots: Slot[];
  backfills: Backfill[];
  preview: Preview | null;
  startDate: Date | null;
  endDate: Date | null;
  showUser?: boolean;
  userName?: string;
  userEmail?: string;
}

export function OrderRow({
  order,
  slots,
  backfills,
  preview,
  startDate,
  endDate,
  showUser = false,
  userName,
  userEmail,
}: OrderRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatDate = (date: Date | null): string => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (date: Date): string => {
    return new Date(date).toLocaleString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Collapsed View */}
      <div
        className="flex items-center gap-4 p-4 hover:bg-gray-50 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-400" />
          )}
        </div>

        {/* Status */}
        <div className="flex-shrink-0 w-24">
          <Badge variant="outline" className="text-xs">
            {order.status ?? "pending"}
          </Badge>
        </div>

        {/* Price */}
        <div className="flex-shrink-0 w-32">
          <span className="text-sm font-semibold text-gray-900">
            {formatCurrency(order.totalPrice, order.currency ?? "cad")}
          </span>
        </div>

        {/* Date Range */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">
              {formatDateRange(startDate, endDate)}
            </span>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-shrink-0 w-20">
          {preview ? (
            preview.fileType === "image" ? (
              <img
                src={preview.url}
                alt={preview.fileName ?? "Preview"}
                className="h-12 w-12 object-cover rounded border border-gray-200"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <video
                src={preview.url}
                className="h-12 w-12 object-cover rounded border border-gray-200"
                muted
                onClick={(e) => e.stopPropagation()}
              />
            )
          ) : (
            <div className="h-12 w-12 rounded border border-gray-200 bg-gray-100 flex items-center justify-center">
              <span className="text-xs text-gray-400">No preview</span>
            </div>
          )}
        </div>

        {/* User (only for admin view) */}
        {showUser && (
          <div className="flex-shrink-0 w-48">
            <div className="text-sm text-gray-900">
              {userName ?? userEmail}
            </div>
            {userName && (
              <div className="text-xs text-gray-500">{userEmail}</div>
            )}
          </div>
        )}
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-4">
          {/* Slots Section */}
          {slots.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                Slots ({slots.length})
              </h4>
              <div className="space-y-2">
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="bg-white rounded border border-gray-200 p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {slot.board.boardType.name}
                          </span>
                          {slot.board.vehicleName && (
                            <span className="text-sm text-gray-500">
                              • {slot.board.vehicleName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>Start: {formatDateTime(slot.startTime)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>End: {formatDateTime(slot.endTime)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Backfills Section */}
          {backfills.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                Backfills ({backfills.length})
              </h4>
              <div className="space-y-2">
                {backfills.map((backfill) => (
                  <div
                    key={backfill.id}
                    className="bg-white rounded border border-gray-200 p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {backfill.hours} hours
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>
                              Start: {formatDateTime(backfill.startTime)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>
                              End: {formatDateTime(backfill.endTime)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creative Preview Section */}
          {preview && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                Creative Preview
              </h4>
              <div className="bg-white rounded border border-gray-200 p-3">
                <div className="flex items-center gap-3">
                  {preview.fileType === "image" ? (
                    <img
                      src={preview.url}
                      alt={preview.fileName ?? "Preview"}
                      className="h-32 w-32 object-cover rounded border border-gray-200"
                    />
                  ) : (
                    <video
                      src={preview.url}
                      className="h-32 w-32 object-cover rounded border border-gray-200"
                      controls
                      muted
                    />
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {preview.fileName}
                    </p>
                    <p className="text-xs text-gray-500">{preview.fileType}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Order Info */}
          <div className="bg-white rounded border border-gray-200 p-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Order ID:</span>{" "}
                <span className="font-mono text-gray-900">
                  {order.id.slice(0, 8)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Approved:</span>{" "}
                <span className="text-gray-900">
                  {order.approved ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

