"use client";

import { Badge } from "~/components/ui/badge";
import { X } from "lucide-react";

interface FilterBadgeProps {
  label: string;
  value: string;
  onRemove: () => void;
}

export function FilterBadge({ label, value, onRemove }: FilterBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className="flex items-center gap-1 px-2 py-1 text-xs"
    >
      <span>
        {label}: {value}
      </span>
      <button
        onClick={onRemove}
        className="ml-1 rounded-full p-0.5 hover:bg-gray-300"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}


