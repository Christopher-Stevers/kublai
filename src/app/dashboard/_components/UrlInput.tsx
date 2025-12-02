"use client";

import { useState } from "react";

interface UrlInputProps {
  targetUrl: string;
  utmTag: string;
  onTargetUrlChange: (url: string) => void;
  onUtmTagChange: (tag: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function UrlInput({
  targetUrl,
  utmTag,
  onTargetUrlChange,
  onUtmTagChange,
  onBack,
  onNext,
}: UrlInputProps) {
  const [urlError, setUrlError] = useState<string | null>(null);

  const validateUrl = (url: string): boolean => {
    if (!url || url.trim() === "") {
      setUrlError(null);
      return true; // URL is optional
    }

    try {
      new URL(url);
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Please enter a valid URL (e.g., https://example.com)");
      return false;
    }
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onTargetUrlChange(value);
    if (value) {
      validateUrl(value);
    } else {
      setUrlError(null);
    }
  };

  const handleNext = () => {
    if (targetUrl && !validateUrl(targetUrl)) {
      return;
    }
    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Target URL & UTM Tag
        </h2>
        <p className="mb-6 text-sm text-gray-600">
          Optionally add a target URL and UTM tag for tracking purposes.
        </p>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="targetUrl"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Target URL
            </label>
            <input
              id="targetUrl"
              type="url"
              value={targetUrl}
              onChange={handleUrlChange}
              onBlur={() => targetUrl && validateUrl(targetUrl)}
              placeholder="https://example.com"
              className={`w-full rounded-lg border px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${
                urlError ? "border-red-300" : "border-gray-300"
              }`}
            />
            {urlError && (
              <p className="mt-1 text-sm text-red-600">{urlError}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Optional: The URL where users will be directed
            </p>
          </div>

          <div>
            <label
              htmlFor="utmTag"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              UTM Tag
            </label>
            <input
              id="utmTag"
              type="text"
              value={utmTag}
              onChange={(e) => onUtmTagChange(e.target.value)}
              placeholder="utm_source=genghis&utm_medium=board"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Optional: UTM parameters for campaign tracking
            </p>
          </div>
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
          onClick={handleNext}
          disabled={!!urlError}
          className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

