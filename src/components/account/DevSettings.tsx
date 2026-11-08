"use client";
import { useDevFeaturesAvailable } from "~/components/app/DevFeaturesProvider";
import { FlaskConicalIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { setDevPreferenceEnabled, useDevPreference } from "~/lib/dev-preference";

export function DevSettings() {
  const available = useDevFeaturesAvailable();
  const enabled = useDevPreference();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConicalIcon className="size-5" />
          Dev
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 font-medium">
          Show Dev features
          <input
            type="checkbox"
            role="switch"
            aria-label="Show Dev features"
            checked={available && enabled}
            disabled={!available}
            className="size-5"
            onChange={(event) => setDevPreferenceEnabled(event.target.checked)}
          />
        </label>
        <p className="text-muted-foreground text-sm">
          {available
            ? "Show features marked Dev. These are still being built and may change. Saved on this device."
            : "Dev features are unavailable in this deployment."}
        </p>
      </CardContent>
    </Card>
  );
}
