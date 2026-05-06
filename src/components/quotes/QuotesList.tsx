"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import Link from "next/link";
import { FileTextIcon, ExternalLinkIcon, MailIcon, WifiOffIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useOfflineQuotes } from "~/hooks/use-offline-documents";

export function QuotesList() {
  const isOnline = useOnlineStatus();
  const { data: serverQuotes, isLoading } = api.materialList.listQuotes.useQuery(undefined, {
    enabled: isOnline,
  });
  const {
    data: quotes,
    cacheLoaded,
    isOfflineFallback,
  } = useOfflineQuotes(serverQuotes);
  const utils = api.useUtils();
  const [sendingEmailFor, setSendingEmailFor] = useState<string | null>(null);

  if ((isLoading || !cacheLoaded) && !quotes) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading quotes...</p>
      </div>
    );
  }

  if (!quotes || quotes.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">Quotes</h2>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            View past quotes and their material lists
          </p>
          {isOfflineFallback && (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
              <WifiOffIcon className="h-3 w-3" /> Offline cached quotes
            </p>
          )}
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <FileTextIcon className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No quotes yet</h3>
          <p className="text-muted-foreground mt-2">
            Quotes will appear here once you generate them from material lists.
          </p>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: string | null) => {
    if (!value) return "$0.00";
    const num = parseFloat(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "CAD",
    }).format(num);
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "N/A";
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(date));
  };

  const handleResendEmail = async (quoteId: string) => {
    setSendingEmailFor(quoteId);
    try {
      const emailContent = await utils.materialList.getQuoteEmailContent.fetch({
        quoteId,
      });

      if (!emailContent) {
        alert("Unable to generate email content for this quote.");
        return;
      }

      const subject = encodeURIComponent(emailContent.subject);
      const body = encodeURIComponent(emailContent.body);
      const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
      window.open(mailtoLink, "_blank");
    } catch (error) {
      console.error("Failed to get email content:", error);
      alert("Failed to generate email. Please try again.");
    } finally {
      setSendingEmailFor(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold sm:text-2xl">Quotes</h2>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          View past quotes and their material lists
        </p>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="divide-y">
          {quotes.map((quote) => (
            <div
              key={quote.id}
              className="flex flex-col gap-3 p-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold sm:text-lg">
                    {quote.quoteNumber || `Quote #${quote.id.slice(0, 8)}`}
                  </h3>
                </div>
                <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-4 sm:text-sm">
                  <span className="font-medium text-foreground">
                    {formatCurrency(quote.total)}
                  </span>
                  {quote.materialListName && (
                    <span className="truncate">
                      Material List: {quote.materialListName}
                    </span>
                  )}
                  {quote.jobName && (
                    <span className="truncate">Job: {quote.jobName}</span>
                  )}
                  <span className="truncate">
                    Created: {formatDate(quote.createdAt)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResendEmail(quote.id)}
                  disabled={!isOnline || sendingEmailFor === quote.id}
                  className="h-11"
                >
                  <MailIcon className="mr-2 h-4 w-4" />
                  {sendingEmailFor === quote.id ? "Opening..." : "Resend Email"}
                </Button>
                {quote.materialListId && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="h-11"
                  >
                    <Link href={`/dashboard/material-lists/${quote.materialListId}`}>
                      <ExternalLinkIcon className="mr-2 h-4 w-4" />
                      View Material List
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
