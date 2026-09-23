"use client";

import { DrawsJobsList } from "~/components/draws/DrawsJobsList";

export default function DrawsPage() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <DrawsJobsList />
      </div>
    </div>
  );
}
