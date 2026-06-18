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
import { Textarea } from "~/components/ui/textarea";
import { useOnlineStatus } from "~/hooks/use-online-status";

interface QuotePreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  jobName: string;
  quoteId?: string;
}

export function QuotePreviewSheet({
  open,
  onOpenChange,
  materialListId,
  jobName,
  quoteId: providedQuoteId,
}: QuotePreviewSheetProps) {
  const [markupPercent, setMarkupPercent] = useState(30);
  const [isEditingMarkup, setIsEditingMarkup] = useState(false);
  const [notes, setNotes] = useState("");
  const [syncError, setSyncError] = useState<string | null>(null);

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: userData } = api.user.getMyRole.useQuery(undefined, {
    enabled: isOnline && open,
  });
  const canGenerateDocuments =
    userData?.permissions.canGenerateDocuments ?? true;
  const { data: materialList } = api.materialList.getMaterialList.useQuery(
    { materialListId },
    { enabled: isOnline && open && !!materialListId && !providedQuoteId },
  );

  // Load existing quote if quoteId is provided
  const { data: existingQuote } = api.materialList.getQuoteById.useQuery(
    { quoteId: providedQuoteId ?? "" },
    { enabled: isOnline && open && !!providedQuoteId },
  );

  // Load notes and markup from quote when available
  useEffect(() => {
    if (providedQuoteId && existingQuote) {
      if (existingQuote.notes) {
        setNotes(existingQuote.notes);
      }
      if (existingQuote.markupPercent) {
        setMarkupPercent(parseFloat(existingQuote.markupPercent.toString()));
      }
    } else if (materialList?.quote?.notes) {
      setNotes(materialList.quote.notes);
    }
  }, [existingQuote, materialList?.quote?.notes, providedQuoteId]);

  const generateQuote = api.materialList.generateQuote.useMutation();

  // Generate quote when sheet opens or markup changes (only if not viewing existing quote)
  useEffect(() => {
    if (
      open &&
      materialListId &&
      !providedQuoteId &&
      canGenerateDocuments &&
      !generateQuote.isPending
    ) {
      void (async () => {
        if (typeof window !== "undefined" && !window.navigator.onLine) {
          setSyncError(
            "Reconnect to sync offline changes before generating a quote.",
          );
          return;
        }

        setSyncError(null);
        generateQuote.mutate({
          materialListId,
          markupPercent,
          notes: notes.trim() || undefined,
        });
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    materialListId,
    markupPercent,
    notes,
    providedQuoteId,
    canGenerateDocuments,
  ]);

  // Get quote email content
  const quoteId = providedQuoteId ?? materialList?.quote.id;
  const { data: emailContent } = api.materialList.getQuoteEmailContent.useQuery(
    { quoteId: quoteId ?? "" },
    { enabled: isOnline && !!quoteId && open },
  );

  const handleEmailQuote = async () => {
    if (!quoteId) return;
    if (!canGenerateDocuments) {
      setSyncError("Standard accounts cannot generate quotes.");
      return;
    }

    // Save notes before emailing (update existing quote or generate new one)
    await generateQuote.mutateAsync({
      materialListId,
      markupPercent,
      notes: notes.trim() || undefined,
      quoteId: providedQuoteId, // Pass quoteId if viewing existing quote
    });

    // Refetch email content to get updated notes
    const updatedEmailContent =
      await utils.materialList.getQuoteEmailContent.fetch({
        quoteId,
      });

    if (!updatedEmailContent) return;

    const subject = encodeURIComponent(updatedEmailContent.subject);
    const body = encodeURIComponent(updatedEmailContent.body);
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    window.open(mailtoLink, "_blank");
  };

  // If viewing existing quote, we need to get material list for items
  const { data: materialListForQuote } =
    api.materialList.getMaterialList.useQuery(
      { materialListId: existingQuote?.materialListId ?? materialListId },
      {
        enabled:
          isOnline &&
          open &&
          !!providedQuoteId &&
          !!existingQuote?.materialListId,
      },
    );

  const displayMaterialList = providedQuoteId
    ? materialListForQuote
    : materialList;

  if (!displayMaterialList && !providedQuoteId) {
    return null;
  }

  // Calculate totals - use existing quote total if available, otherwise calculate
  const subtotal = displayMaterialList
    ? displayMaterialList.materialTotal
    : existingQuote
      ? parseFloat(existingQuote.subtotalMaterials?.toString() ?? "0")
      : 0;
  const markup = markupPercent / 100;
  const total = existingQuote
    ? parseFloat(existingQuote.total?.toString() ?? "0")
    : subtotal * (1 + markup);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {providedQuoteId ? "View/Edit Quote" : "Quote"} for: {jobName}
          </DialogTitle>
          <DialogDescription>
            {providedQuoteId
              ? "Review, update, and email the quote"
              : "Review and email the quote"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {syncError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {syncError}
            </div>
          )}
          {!canGenerateDocuments && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Standard accounts cannot generate quotes.
            </div>
          )}
          {/* Line Items */}
          {displayMaterialList && (
            <div>
              <h3 className="mb-2 font-semibold">Materials:</h3>
              <div className="space-y-2">
                {displayMaterialList.items.map((item) => {
                  const qty = parseFloat(String(item.quantity));
                  const price = item.extendedPrice
                    ? parseFloat(String(item.extendedPrice))
                    : 0;
                  const partDef = item.partDefinition as
                    | { displayName?: string }
                    | null
                    | undefined;
                  const displayName = String(
                    partDef?.displayName || item.descriptionSnapshot || "Item",
                  );
                  return (
                    <div
                      key={String(item.id)}
                      className="flex justify-between border-b pb-2 text-sm"
                    >
                      <span>
                        {displayName} × {qty}
                      </span>
                      <span>${price.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="space-y-2 border-t pt-4">
            <div className="flex justify-between">
              <span>Materials Subtotal:</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>
                Markup(this will be auto applied to each item in the quote):
              </span>
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
                        notes: notes.trim() || undefined,
                        quoteId: providedQuoteId,
                      });
                    }}
                    disabled={!canGenerateDocuments}
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

          {/* Notes */}
          <div className="space-y-2 border-t pt-4">
            <label htmlFor="quote-notes" className="text-sm font-medium">
              Notes (optional)
            </label>
            <Textarea
              id="quote-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes for the quote..."
              className="min-h-[100px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button
            onClick={handleEmailQuote}
            disabled={!emailContent || !quoteId || !canGenerateDocuments}
          >
            Email Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
