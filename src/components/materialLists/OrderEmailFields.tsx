"use client";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { OrderEmailSkuOption } from "./OrderEmailSkuOption";
import type { SupplierSkuLine } from "~/lib/order-email-lines";

type EmailDraft = {
  subject: string;
  body: string;
  supplierSkuLines?: SupplierSkuLine[];
};
export function OrderEmailFields({
  id,
  supplierId,
  draft,
  disabled,
  notes,
  onDraftChange,
  onNotesChange,
}: {
  id: string;
  supplierId?: string;
  draft: EmailDraft;
  disabled: boolean;
  notes: string;
  onDraftChange: (draft: EmailDraft) => void;
  onNotesChange?: (notes: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor={`order-subject-${id}`} className="text-sm font-medium">
          Subject
        </label>
        <Input
          id={`order-subject-${id}`}
          value={draft.subject}
          onChange={(event) =>
            onDraftChange({ ...draft, subject: event.target.value })
          }
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`order-body-${id}`} className="text-sm font-medium">
          Email
        </label>
        <OrderEmailSkuOption
          supplierId={supplierId}
          body={draft.body}
          lines={draft.supplierSkuLines}
          onChange={(body) => onDraftChange({ ...draft, body })}
        />
        <Textarea
          id={`order-body-${id}`}
          value={draft.body}
          onChange={(event) =>
            onDraftChange({ ...draft, body: event.target.value })
          }
          className="min-h-[20rem] font-mono text-sm"
          disabled={disabled}
        />
      </div>
      <div className="space-y-2 border-t pt-4">
        <label htmlFor={`order-notes-${id}`} className="text-sm font-medium">
          Internal Notes
        </label>
        <Textarea
          id={`order-notes-${id}`}
          value={notes}
          onChange={(event) => onNotesChange?.(event.target.value)}
          placeholder="Notes saved on the sent order"
          className="min-h-[80px]"
          disabled={disabled}
        />
      </div>
    </>
  );
}
