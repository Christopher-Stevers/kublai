"use client";

import { api } from "~/trpc/react";

interface CreativeSelectorProps {
  selectedCreativeId: string | null;
  onCreativeSelect: (creativeId: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function CreativeSelector({
  selectedCreativeId,
  onCreativeSelect,
  onBack,
  onNext,
}: CreativeSelectorProps) {
  const { data: creatives, isLoading } = api.creative.getAll.useQuery();

  if (isLoading) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">Loading creatives...</div>
      </div>
    );
  }

  if (!creatives || creatives.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-white p-8 shadow-sm">
          <div className="text-center text-gray-600">
            No creatives available. This feature is open-ended for now.
          </div>
        </div>
        <div className="flex gap-4">
          <button
            onClick={onBack}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Back
          </button>
          <button
            onClick={onNext}
            className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800"
          >
            Continue (Skip Creative)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Select Creative
        </h2>
        <p className="mb-4 text-sm text-gray-600">
          Choose a creative for your order (open-ended implementation)
        </p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {creatives.map((creative) => (
            <button
              key={creative.id}
              onClick={() => onCreativeSelect(creative.id)}
              className={`rounded-lg border-2 p-4 text-left transition-colors ${
                selectedCreativeId === creative.id
                  ? "border-gray-900 bg-gray-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <h3 className="font-semibold text-gray-900">
                {creative.fileName}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Uploaded: {new Date(creative.uploadDate).toLocaleDateString()}
              </p>
              {creative.approved && (
                <span className="mt-2 inline-block rounded bg-green-100 px-2 py-1 text-xs text-green-800">
                  Approved
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <button
          onClick={onBack}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!selectedCreativeId}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Review Order
        </button>
      </div>
    </div>
  );
}

