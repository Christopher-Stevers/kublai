type RoomAnchor = {
  name: string;
  kind?: "unit" | "room";
};

// Apartment occupancy descriptions are often placed inside living spaces.
// They describe the entire unit, not a second physical bedroom at that point.
// Anchor the full string so numbered room labels ("BEDROOM 2") remain usable.
const BEDROOM_OCCUPANCY =
  /^\d+[\s-]*(?:bed(?:room)?s?|bed[\s-]+rooms?|bdrm|br|bd)(?:[\s-]+(?:bf|barrier[\s-]+free|accessible))?(?:[\s-]+(?:unit|suite|apartment))?$/i;

/** Keep unit context without letting it name or partition physical rooms. */
export function splitPhysicalRoomSeeds<T extends RoomAnchor>(
  seeds: readonly T[],
): { physical: T[]; unitContext: T[] } {
  const physical: T[] = [];
  const unitContext: T[] = [];
  for (const seed of seeds) {
    const name = seed.name.trim().replace(/[\u2010-\u2015\u2212]/g, "-");
    if (seed.kind === "unit" || BEDROOM_OCCUPANCY.test(name))
      unitContext.push(seed);
    else physical.push(seed);
  }
  return { physical, unitContext };
}

export function physicalRoomSeeds<T extends RoomAnchor>(
  seeds: readonly T[],
): T[] {
  return splitPhysicalRoomSeeds(seeds).physical;
}
