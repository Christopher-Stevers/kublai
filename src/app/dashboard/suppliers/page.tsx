"use client";

import { SupplierList } from "~/components/suppliers/SupplierList";

export default function SuppliersPage() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <SupplierList />
      </div>
    </div>
  );
}
