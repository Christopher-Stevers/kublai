import { packContents, pieceCount, packsFromPieces } from "./pack-quantity";
/**
 * Adding a prefab to a material list: each prefab part times the multiplier.
 * A part already on the list gets the quantity added to that line (preferring
 * the line with the same supplier); anything else becomes a new line.
 */
export type PrefabLine = {
  partDefinitionId: string;
  supplierPartId: string | null;
  quantity: number;
  piecesPerPack?: number | null;
};
export type ListLine = {
  id: string;
  partDefinitionId: string | null;
  supplierPartId: string | null;
  quantity: string | number;
};

export function planPrefabAdd<P extends PrefabLine>(
  prefabLines: P[],
  listLines: ListLine[],
  multiplier: number,
) {
  const updates = new Map<string, number>();
  const adds: Array<P & { quantity: number }> = [];
  const quantityOf = (line: ListLine) =>
    updates.get(line.id) ?? (Number(line.quantity) || 0);
  for (const prefabLine of prefabLines) {
    const contents = prefabLine.piecesPerPack;
    const quantity =
      packContents(contents) > 1
        ? packsFromPieces(
            pieceCount(prefabLine.quantity, contents) * multiplier,
            contents,
          )
        : roundQuantity(prefabLine.quantity * multiplier);
    if (!(quantity > 0)) continue;
    const samePart = listLines.filter(
      (line) => line.partDefinitionId === prefabLine.partDefinitionId,
    );
    const target =
      samePart.find(
        (line) =>
          prefabLine.supplierPartId &&
          line.supplierPartId === prefabLine.supplierPartId,
      ) ?? samePart[0];
    if (target)
      updates.set(
        target.id,
        packContents(contents) > 1
          ? packsFromPieces(
              pieceCount(quantityOf(target), contents) +
                pieceCount(quantity, contents),
              contents,
            )
          : roundQuantity(quantityOf(target) + quantity),
      );
    else adds.push({ ...prefabLine, quantity });
  }
  return {
    updates: [...updates].map(([itemId, quantity]) => ({ itemId, quantity })),
    adds,
  };
}

/** Avoids float noise like 0.1 * 3 = 0.30000000000000004. */
function roundQuantity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A material list's lines as prefab parts ("Save as prefab"). One-off lines
 * without a catalogue part are left out; offline supplier ids (not yet synced)
 * are dropped so the server accepts them.
 */
export function prefabItemsFromList(listLines: ListLine[]) {
  return listLines.flatMap((line) => {
    const quantity = Number(line.quantity);
    return line.partDefinitionId && quantity > 0
      ? [
          {
            partDefinitionId: line.partDefinitionId,
            supplierPartId:
              line.supplierPartId && UUID.test(line.supplierPartId)
                ? line.supplierPartId
                : null,
            quantity,
          },
        ]
      : [];
  });
}
