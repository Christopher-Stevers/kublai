"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { isIosDevice, useInstallPrompt } from "~/lib/install-prompt";

/**
 * Installs ForemanHQ to the home screen: the browser's own install prompt
 * where it offers one (Chrome, Edge, Android), otherwise the exact steps for
 * this phone (iPhone only installs from Safari's Share menu). Hidden once the
 * app is installed.
 */
export function InstallAppButton({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { installed, install } = useInstallPrompt();
  const [stepsOpen, setStepsOpen] = useState(false);
  if (installed) return null;
  const ios = isIosDevice();
  return (
    <>
      <Button
        data-app-install-button
        variant="outline"
        className={`h-auto shrink-0 py-1.5 text-center text-xs leading-tight whitespace-normal ${compact ? "max-w-[5rem] px-2 sm:max-w-[11.5rem] sm:px-3" : "max-w-[11.5rem] px-3"} ${className}`}
        onClick={async () => {
          if (!(await install())) setStepsOpen(true);
        }}
      >
        {compact ? (
          <>
            <span className="sm:hidden">Install app</span>
            <span className="hidden sm:inline">
              Add To Homescreen For Notifications and Better Performance
            </span>
          </>
        ) : (
          "Add To Homescreen For Notifications and Better Performance"
        )}
      </Button>
      <Dialog open={stepsOpen} onOpenChange={setStepsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add ForemanHQ to your home screen</DialogTitle>
            <DialogDescription>
              {ios
                ? "iPhone only allows this from Safari's Share menu:"
                : "Your browser installs apps from its menu:"}
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {ios ? (
              <>
                <li>
                  Open ForemanHQ in{" "}
                  <span className="font-semibold">Safari</span>.
                </li>
                <li>
                  Tap the <span className="font-semibold">Share</span> button
                  (the square with an arrow).
                </li>
                <li>
                  Choose{" "}
                  <span className="font-semibold">Add to Home Screen</span>,
                  then tap <span className="font-semibold">Add</span>.
                </li>
              </>
            ) : (
              <>
                <li>
                  Tap the browser's <span className="font-semibold">⋮</span>{" "}
                  menu.
                </li>
                <li>
                  Choose <span className="font-semibold">Install app</span> (or{" "}
                  <span className="font-semibold">Add to Home screen</span>).
                </li>
                <li>Confirm, then open ForemanHQ from your home screen.</li>
              </>
            )}
          </ol>
          <p className="text-muted-foreground text-xs">
            Already installed? Open ForemanHQ from your home screen to get
            notifications.
          </p>
          <DialogFooter>
            <Button onClick={() => setStepsOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
