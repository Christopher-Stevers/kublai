"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

interface QuotePreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  jobName: string;
}

export function QuotePreviewSheet({
  open,
  onOpenChange,
  materialListId,
  jobName,
}: QuotePreviewSheetProps) {
  const [markupPercent, setMarkupPercent] = useState(30);
  const [isEditingMarkup, setIsEditingMarkup] = useState(false);

  const utils = api.useUtils();
  const { data: materialList } = api.materialList.getMaterialList.useQuery(
    { materialListId },
    { enabled: open && !!materialListId },
  );

  const generateQuote = api.materialList.generateQuote.useMutation({
    onSuccess: () => {
      void utils.materialList.getMaterialList.invalidate({ materialListId });
    },
  });

  // Generate quote when sheet opens or markup changes
  useEffect(() => {
    if (open && materialListId && !generateQuote.isPending) {
      generateQuote.mutate({
        materialListId,
        markupPercent,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, materialListId, markupPercent]);

  // Get quote email content
  const quoteId = materialList?.quote.id;
  const { data: emailContent } = api.materialList.getQuoteEmailContent.useQuery(
    { quoteId: quoteId ?? "" },
    { enabled: !!quoteId && open },
  );

  const handleEmailQuote = () => {
    if (!emailContent) return;

    const subject = encodeURIComponent(emailContent.subject);
    const body = encodeURIComponent(emailContent.body);
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    window.location.href = mailtoLink;
  };

  if (!materialList) {
    return null;
  }

  const subtotal = materialList.materialTotal;
  const markup = markupPercent / 100;
  const total = subtotal * (1 + markup);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quote for: {jobName}</DialogTitle>
          <DialogDescription>Review and email the quote</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Line Items */}
          <div>
            <h3 className="mb-2 font-semibold">Materials:</h3>
            <div className="space-y-2">
              {materialList.items.map((item) => {
                const qty = parseFloat(String(item.quantity));
                const price = item.extendedPrice
                  ? parseFloat(String(item.extendedPrice))
                  : 0;
                const partDef = item.partDefinition as { displayName?: string } | null | undefined;
                const displayName = String(partDef?.displayName || item.descriptionSnapshot || "Item");
                return (
                  <div
                    key={String(item.id)}
                    className="flex justify-between border-b pb-2 text-sm"
                  >
                    <span>
                      {displayName}{" "}
                      × {qty}
                    </span>
                    <span>${price.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-2 border-t pt-4">
            <div className="flex justify-between">
              <span>Materials Subtotal:</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Markup:</span>
              {isEditingMarkup ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={markupPercent}
                    onChange={(e) =>
                      setMarkupPercent(parseFloat(e.target.value) || 0)
                    }
                    className="w-20"
                    min="0"
                    max="1000"
                  />
                  <span>%</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsEditingMarkup(false);
                      generateQuote.mutate({
                        materialListId,
                        markupPercent,
                      });
                    }}
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{markupPercent}%</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsEditingMarkup(true)}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>
            <div className="flex justify-between border-t pt-2 font-bold">
              <span>Total:</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button
            onClick={handleEmailQuote}
            disabled={!emailContent || !quoteId}
          >
            Email Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

