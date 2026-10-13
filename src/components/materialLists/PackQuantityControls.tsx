"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { purchaseQuantity } from "~/lib/purchase-quantity";
import { packContents, packsFromPieces, pieceCount } from "~/lib/pack-quantity";

/** Values leaving this control remain selling packs, including fractional demand. */
export function PackQuantityControls({quantity, piecesPerPack, bulkUnit, individualUnit, onChange, minimum = 0, disabled = false, orderMultiple}: {
  quantity: number;
  piecesPerPack: number;
  bulkUnit?: string | null;
  individualUnit?: string | null;
  onChange: (packs: number) => void;
  minimum?: number;
  disabled?: boolean;
  orderMultiple?: string | null;
}) {
  const contents = packContents(piecesPerPack);
  const bulkLabel = bulkUnit || "pack";
  const individualLabel = individualUnit || "pcs";
  const ordered = purchaseQuantity(quantity, orderMultiple, contents);
  const plural = ({box:"boxes", pack:"packs", coil:"coils", roll:"rolls", length:"lengths"} as Record<string,string>)[bulkLabel] || bulkLabel;
  const [editingIndividuals, setEditingIndividuals] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<string | null>(null);
  const [individualDraft, setIndividualDraft] = useState<string | null>(null);
  const save = (value: number, individuals: boolean) => {
    if (!Number.isSafeInteger(value) || value < 0) return;
    const packs = individuals ? packsFromPieces(value, contents) : value;
    if (packs >= minimum && packs <= 999999.999999) onChange(packs);
  };
  const step = (delta: number) => {
    const next = Math.ceil(quantity) + delta;
    if (next <= 0) {setEditingIndividuals(true); return;}
    setBulkDraft(null);
    save(next, false);
  };
  const finishIndividualEdit = () => {setIndividualDraft(null); setEditingIndividuals(false);};
  return <div className="flex min-w-0 flex-col gap-1" aria-label="Pack quantity controls">
    <div className="flex min-w-0 items-center gap-1">
      <Button type="button" variant="outline" className="h-9 w-8 shrink-0 p-0" disabled={disabled} aria-label="Decrease quantity" onClick={()=>step(-1)}><MinusIcon className="h-4 w-4" /></Button>
      <div className="border-input flex h-9 min-w-0 flex-1 items-center rounded-md border">
        <Input aria-label={`Quantity in ${bulkUnit || "packs"}`} type="text" inputMode="numeric" disabled={disabled}
          value={bulkDraft ?? String(ordered)}
          onChange={event=>{setBulkDraft(event.target.value); if(event.target.value.trim()) save(Number(event.target.value), false);}}
          onBlur={()=>setBulkDraft(null)}
          onKeyDown={event=>{if(event.key === "Enter") event.currentTarget.blur(); if(event.key === "ArrowDown") {event.preventDefault(); step(-1);}}}
          className="h-9 min-w-0 flex-1 border-0 px-1 text-center shadow-none" />
        <span className="shrink-0 pr-2 text-sm">{ordered === 1 ? bulkLabel : plural}</span>
      </div>
      <Button type="button" variant="outline" className="h-9 w-8 shrink-0 p-0" disabled={disabled} aria-label="Increase quantity" onClick={()=>step(1)}><PlusIcon className="h-4 w-4" /></Button>
    </div>
    <div className="flex min-h-8 items-center justify-center gap-1 text-xs">
      {editingIndividuals ? <>
        <Input autoFocus aria-label={`Quantity in ${individualLabel}`} type="number" inputMode="numeric" min="0" step="1" disabled={disabled}
          value={individualDraft ?? pieceCount(quantity, contents)}
          onFocus={event=>event.currentTarget.select()}
          onChange={event=>{setIndividualDraft(event.target.value); if(event.target.value.trim()) save(Number(event.target.value), true);}}
          onBlur={finishIndividualEdit}
          onKeyDown={event=>{if(event.key === "Enter" || event.key === "Escape") {event.preventDefault(); event.currentTarget.blur();}}}
          className="h-8 w-24 px-1 text-center text-xs" />
        <span>{individualLabel}</span>
      </> : <button type="button" disabled={disabled} className="py-1 tabular-nums" aria-label={`Edit ${individualLabel}: ${pieceCount(quantity, contents)}`} onClick={()=>setEditingIndividuals(true)}>{pieceCount(quantity, contents)} {individualLabel}</button>}
    </div>
  </div>;
}
