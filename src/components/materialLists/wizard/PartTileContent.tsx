import type { ReactNode } from "react";
import Image from "next/image";
import { AlertCircle } from "lucide-react";
import { QuotedBadge } from "~/components/jobPricing/QuotedBadge";
import { formatPackQuantity } from "~/lib/pack-quantity";

export const PART_TILE_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(min(1.5in,100%),2in))] justify-center justify-items-center gap-3";
export const PART_TILE_CARD_CLASS =
  "relative w-full max-w-[2in] gap-0 overflow-hidden rounded-2xl py-0";

/** Shared photo, badges and title for Select Parts and Chosen Parts. */
export function PartTileContent({
  part,
  quantity = 0,
  details,
  photoAction,
}: {
  part: {
    displayName: string;
    imageUrl: string | null;
    piecesPerPack?: number | null;
    jobPriceStatus?: string;
    imageApprovalStatus?: "approved" | "suggested" | "missing";
  };
  quantity?: number;
  details?: ReactNode;
  photoAction?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col p-3">
      <div className="part-photo-frame bg-muted relative mb-3 aspect-square w-full overflow-hidden rounded-xl">
        {part.imageUrl ? (
          <Image
            src={part.imageUrl}
            alt={part.displayName}
            fill
            className="part-photo object-cover"
            draggable={false}
          />
        ) : (
          <div className="text-muted-foreground/70 flex h-full items-center justify-center">
            <AlertCircle className="h-8 w-8" />
          </div>
        )}

        {photoAction && (
          <div className="absolute top-2 left-2">{photoAction}</div>
        )}
        <div className="absolute top-2 right-2 flex justify-end">
          {quantity > 0 && (
            <div className="bg-primary text-primary-foreground flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold shadow-sm sm:h-7 sm:min-w-7 sm:text-sm">
              {formatPackQuantity(quantity, part.piecesPerPack)}
            </div>
          )}
        </div>
        <QuotedBadge status={part.jobPriceStatus} onPhoto />
        {part.imageApprovalStatus === "suggested" && (
          <div className="absolute right-2 bottom-2 rounded bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white shadow">
            Needs approval
          </div>
        )}
      </div>

      <div className="text-foreground flex flex-col items-center justify-center gap-1 text-center">
        <h4 className="line-clamp-4 text-sm leading-snug font-medium">
          {part.displayName}
        </h4>
        {details}
      </div>
    </div>
  );
}
