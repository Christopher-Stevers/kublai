"use client";
import { FlaskConicalIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { setExperimentalEnabled, useExperimentalEnabled } from "~/lib/experimental";

export function ExperimentalSettings() {
  const enabled = useExperimentalEnabled();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConicalIcon className="size-5" />
          Experimental
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 font-medium">
          Show experimental features
          <input
            type="checkbox"
            role="switch"
            aria-label="Show experimental features"
            checked={enabled}
            className="size-5"
            onChange={(event) => setExperimentalEnabled(event.target.checked)}
          />
        </label>
        <p className="text-muted-foreground text-sm">
          Experimental features are still being built and may change or break.
          Turn this off to hide them, including Models, Systems and packing slip
          test reviews. Saved on this device.
        </p>
      </CardContent>
    </Card>
  );
}
