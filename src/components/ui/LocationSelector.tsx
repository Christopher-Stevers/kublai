"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "~/trpc/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Search, ChevronDownIcon } from "lucide-react";
import { LocationFormDialog } from "~/components/materialLists/LocationFormDialog";
import { useOnlineStatus } from "~/hooks/use-online-status";

interface LocationSelectorProps {
  value: string | null | undefined;
  onChange: (locationId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function LocationSelector({
  value,
  onChange,
  disabled = false,
  placeholder = "Select location...",
}: LocationSelectorProps) {
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

  const isOnline = useOnlineStatus();

  // Search locations
  const { data: locations, isLoading: locationsLoading } =
    api.location.searchLocations.useQuery(
      { query: debouncedSearchQuery || undefined },
      { enabled: isOnline && (isDropdownOpen || !!debouncedSearchQuery || !!value) },
    );

  // Find selected location
  const selectedLocation = useMemo(() => {
    if (!value || !locations) return null;
    return locations.find((loc) => loc.id === value) ?? null;
  }, [value, locations]);

  const displayLocationName = useMemo(() => {
    if (!selectedLocation) return placeholder;
    if (selectedLocation.city || selectedLocation.region) {
      const locationParts = [selectedLocation.city, selectedLocation.region]
        .filter(Boolean)
        .join(", ");
      return `${selectedLocation.name} - ${locationParts}`;
    }
    return selectedLocation.name;
  }, [selectedLocation, placeholder]);

  const handleLocationSelect = (location: {
    id: string;
    name: string;
    city?: string | null;
    region?: string | null;
  }) => {
    onChange(location.id);
    setIsDropdownOpen(false);
    setSearchQuery("");
  };

  const handleClearLocation = () => {
    onChange(null);
    setIsDropdownOpen(false);
    setSearchQuery("");
  };

  const utils = api.useUtils();
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
        city: newLocation.city,
        region: newLocation.region,
      });
    }
  };

  return (
    <div className="w-full">
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between"
            type="button"
            disabled={disabled}
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

      <LocationFormDialog
        open={isLocationDialogOpen}
        onOpenChange={setIsLocationDialogOpen}
        onLocationCreated={handleLocationCreated}
      />
    </div>
  );
}

