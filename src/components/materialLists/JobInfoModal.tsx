"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Search, ChevronDownIcon } from "lucide-react";
import { LocationFormDialog } from "./LocationFormDialog";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";

interface JobInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materialListId: string;
  initialName?: string | null;
  initialLocationId?: string;
}

export function JobInfoModal({
  open,
  onOpenChange,
  materialListId,
  initialName,
  initialLocationId,
}: JobInfoModalProps) {
  const [jobName, setJobName] = useState(initialName || "");
  const [selectedLocation, setSelectedLocation] = useState<{
    id: string;
    name: string;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const utils = api.useUtils();
  const isOnline = useOnlineStatus();
  const { data: materialList } = api.materialList.getMaterialList.useQuery(
    { materialListId },
    { enabled: isOnline && open && !!materialListId },
  );
  // Search locations - always enabled to load initial location if needed
  const { data: locations, isLoading: locationsLoading } =
    api.location.searchLocations.useQuery(
      { query: debouncedSearchQuery || undefined },
      {
        enabled:
          isOnline && (isDropdownOpen || !!debouncedSearchQuery || !!initialLocationId),
      },
    );

  // Find selected location in results when locations load
  useEffect(() => {
    if (initialLocationId && locations && !selectedLocation) {
      const found = locations.find((loc) => loc.id === initialLocationId);
      if (found) {
        setSelectedLocation({
          id: found.id,
          name: found.name,
          address1: found.address1,
          address2: found.address2,
          city: found.city,
          region: found.region,
          postalCode: found.postalCode,
          country: found.country,
        });
      }
    }
  }, [initialLocationId, locations, selectedLocation]);

  const handleLocationSelect = (location: {
    id: string;
    name: string;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }) => {
    setSelectedLocation(location);
    setIsDropdownOpen(false);
    setSearchQuery("");
  };

  const handleClearLocation = () => {
    setSelectedLocation(null);
    setIsDropdownOpen(false);
    setSearchQuery("");
  };

  const handleLocationCreated = async (locationId: string) => {
    // Refetch locations to get the new one
    const updatedLocations = await utils.location.searchLocations.fetch({
      query: undefined,
    });
    // Find and select the newly created location
    const newLocation = updatedLocations.find((loc) => loc.id === locationId);
    if (newLocation) {
      handleLocationSelect({
        id: newLocation.id,
        name: newLocation.name,
        address1: newLocation.address1,
        address2: newLocation.address2,
        city: newLocation.city,
        region: newLocation.region,
        postalCode: newLocation.postalCode,
        country: newLocation.country,
      });
    }
  };

  const handleSave = () => {
    console.log(jobName, selectedLocation, "job name and location");
    if (!jobName.trim()) {
      return;
    }

    const jobId =
      materialList?.job &&
      typeof materialList.job === "object" &&
      "id" in materialList.job
        ? materialList.job.id
        : null;

    if (jobId) {
      void mutateMaterialListAndSync(getMaterialListReplicache().mutate.updateJob({
        jobId,
        name: jobName.trim(),
        locationId: selectedLocation?.id ?? null,
      }));
    }
    onOpenChange(false);
  };

  const displayLocationName = useMemo(() => {
    if (!selectedLocation) return "Select location...";
    if (selectedLocation.city || selectedLocation.region) {
      const locationParts = [selectedLocation.city, selectedLocation.region]
        .filter(Boolean)
        .join(", ");
      return `${selectedLocation.name} - ${locationParts}`;
    }
    return selectedLocation.name;
  }, [selectedLocation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Job Details</DialogTitle>
          <DialogDescription>
            Enter the job name and optional location for this material list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label htmlFor="job-name" className="text-sm font-medium">
              Job Name *
            </label>
            <Input
              id="job-name"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="e.g., Smith Bathroom Reno"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="location" className="text-sm font-medium">
              Location (Optional)
            </label>
            <DropdownMenu
              open={isDropdownOpen}
              onOpenChange={setIsDropdownOpen}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="mt-1 w-full justify-between"
                  type="button"
                >
                  <span className="truncate">{displayLocationName}</span>
                  <ChevronDownIcon className="h-4 w-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) p-2"
                align="start"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                    <Input
                      placeholder="Search locations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {locationsLoading ? (
                      <div className="text-muted-foreground px-2 py-1.5 text-sm">
                        Loading...
                      </div>
                    ) : locations && locations.length > 0 ? (
                      <>
                        {locations.map((location) => {
                          const locationDisplay =
                            location.city || location.region
                              ? `${location.name} - ${[
                                  location.city,
                                  location.region,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}`
                              : location.name;
                          return (
                            <DropdownMenuItem
                              key={location.id}
                              onClick={() =>
                                handleLocationSelect({
                                  id: location.id,
                                  name: location.name,
                                  city: location.city,
                                  region: location.region,
                                })
                              }
                              className="cursor-pointer"
                            >
                              {locationDisplay}
                            </DropdownMenuItem>
                          );
                        })}
                      </>
                    ) : debouncedSearchQuery ? (
                      <div className="text-muted-foreground px-2 py-1.5 text-sm">
                        No locations found
                      </div>
                    ) : (
                      <div className="text-muted-foreground px-2 py-1.5 text-sm">
                        Start typing to search...
                      </div>
                    )}
                  </div>
                  {selectedLocation && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={handleClearLocation}
                        className="text-muted-foreground cursor-pointer"
                      >
                        Clear selection
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setIsDropdownOpen(false);
                      setIsLocationDialogOpen(true);
                    }}
                    className="cursor-pointer font-medium"
                  >
                    + Add new location...
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <LocationFormDialog
            open={isLocationDialogOpen}
            onOpenChange={setIsLocationDialogOpen}
            onLocationCreated={handleLocationCreated}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!jobName.trim()}
          >
            Save & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
