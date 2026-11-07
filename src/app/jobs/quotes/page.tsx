"use client";

import { QuotesList } from "~/components/quotes/QuotesList";

export default function QuotesPage() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <QuotesList />
      </div>
    </div>
  );
}
