"use client";

import { AssistanceLink } from "~/components/assist/AssistanceLink";

import { SupplierList } from "~/components/suppliers/SupplierList";

export default function SuppliersPage() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4"><AssistanceLink mode="supplier">Match products</AssistanceLink></div>
        <SupplierList />
      </div>
    </div>
  );
}
