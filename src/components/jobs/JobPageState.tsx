"use client";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
export function JobPageState({ loading }: { loading: boolean }) {
  const router = useRouter();
  if (loading) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="space-y-3">
            <div className="skeleton-shimmer h-8 w-64 max-w-full rounded" />
            <div className="skeleton-shimmer h-4 w-80 max-w-full rounded" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="skeleton-shimmer h-6 w-2/3 rounded" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="skeleton-shimmer h-4 w-1/2 rounded" />
                    <div className="skeleton-shimmer h-4 w-1/3 rounded" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">Job not found</p>
          <Button onClick={() => router.push("/jobs")}>Back to Jobs</Button>
        </div>
      </div>
    </div>
  );
}
