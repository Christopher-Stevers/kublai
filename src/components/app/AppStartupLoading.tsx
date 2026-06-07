import { APP_NAME } from "~/constants/app";

function JobCardSkeleton({ index }: { index: number }) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="h-5 w-2/3 rounded bg-gray-200" />
      <div className="mt-4 space-y-3">
        <div className="h-4 w-5/6 rounded bg-gray-100" />
        <div className="h-4 w-1/2 rounded bg-gray-100" />
        <div className="h-4 w-1/3 rounded bg-gray-100" />
      </div>
    </div>
  );
}

export function AppStartupLoading() {
  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900">
      <div className="sticky top-0 z-50 border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold sm:text-xl">{APP_NAME}</div>
          <div className="h-10 w-10 rounded-lg bg-gray-100" />
        </div>
      </div>

      <main className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="h-8 w-40 rounded bg-gray-200" />
              <div className="mt-3 h-4 w-64 max-w-[70vw] rounded bg-gray-100" />
            </div>
            <div className="h-11 w-full rounded-lg bg-gray-200 sm:w-32" />
          </div>

          <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <JobCardSkeleton key={index} index={index} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
