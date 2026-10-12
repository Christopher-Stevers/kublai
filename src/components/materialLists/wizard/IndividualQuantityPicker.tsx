"use client";

import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { VerticalPickerOverlay } from "./VerticalPickerOverlay";

export function individualUnitLabel(unit?: string | null) {
  const value = unit?.trim().toLowerCase();
  return ({ pcs: "piece", pieces: "piece", feet: "foot", inches: "inch" } as Record<string, string>)[value ?? ""] ?? (value || "piece");
}

/** Opened only after the user selects the individual-unit entry above zero. */
export function IndividualQuantityPicker({partName, unit, onSelect, onCancel}: {
  partName: string;
  unit?: string | null;
  onSelect: (quantity: number) => void;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const valueRef = useRef(1);
  const drag = useRef<{id: number; y: number; value: number} | null>(null);
  const label = individualUnitLabel(unit);
  const update = (value: number) => {
    valueRef.current = Math.max(1, Math.min(999999, value));
    setQuantity(valueRef.current);
  };
  return <div className="absolute inset-0 z-[95] touch-none" role="dialog" aria-label={`Quantity per ${label}`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = {id:event.pointerId, y:event.clientY, value:valueRef.current};
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      event.preventDefault();
      update(start.value + Math.round((event.clientY-start.y)/18));
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      onSelect(valueRef.current);
    }}
    onPointerCancel={() => {drag.current = null;}}
    onWheel={event => {if (event.deltaY) update(valueRef.current + Math.sign(event.deltaY));}}
    onKeyDown={event => {
      if (event.key === "Escape") {event.stopPropagation(); onCancel();}
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {event.preventDefault(); update(valueRef.current + (event.key === "ArrowDown" ? 1 : -1));}
    }}>
    <VerticalPickerOverlay className="absolute" title={`Per ${label}`} subtitle={<>{partName}<br />Drag to choose, release to select</>} centerIndex={quantity} getItem={value => value >= 1 && value <= 999999 ? value : null} renderItem={value => value.toLocaleString("en-CA")} />
    <div className="absolute inset-x-0 bottom-4 z-[100] flex justify-center gap-3" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
      <Button variant="outline" onClick={onCancel}>Cancel</Button>
      <Button autoFocus onClick={() => onSelect(valueRef.current)}>Select {quantity} {unit || "pcs"}</Button>
    </div>
  </div>;
}
