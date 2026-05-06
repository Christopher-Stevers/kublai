"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";

export const DEFAULT_PAGE_SIZE = 200;

export type UseClientPaginationResult<T> = ReturnType<typeof useClientPagination<T>>;

export function useClientPagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setPage(1);
  }, [totalItems, pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return {
    page,
    setPage,
    pageSize,
    totalItems,
    totalPages,
    showPagination: totalItems > pageSize,
    startItem: totalItems === 0 ? 0 : (page - 1) * pageSize + 1,
    endItem: Math.min(page * pageSize, totalItems),
    paginatedItems,
  };
}

interface ListPaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}

export function ListPagination({
  page,
  totalPages,
  totalItems,
  startItem,
  endItem,
  itemLabel,
  onPageChange,
}: ListPaginationProps) {
  if (totalItems <= DEFAULT_PAGE_SIZE) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
      <div>
        Showing {startItem}-{endItem} of {totalItems} {itemLabel}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
