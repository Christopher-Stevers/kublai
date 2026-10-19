"use client";
import { useState } from "react";
import { LayersIcon } from "lucide-react";
import { MEASURE_TILE } from "./SheetMeasureBar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "~/components/ui/dropdown-menu";

export function MeasurementLayerPicker({
  value,
  layers,
  onChange,
  onAdd,
}: {
  value: string[];
  layers: string[];
  onChange: (value: string[]) => void;
  onAdd?: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Measurement layer: ${value.join(", ")}`}
          title={`Layer: ${value.join(", ")}`}
          className={MEASURE_TILE}
        >
          <LayersIcon aria-hidden="true" />
          <span className="max-w-full truncate">
            {value.length === 1 && value[0] !== "General" ? value[0] : "Layers"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-64"
        onEscapeKeyDown={(event) => { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); }}>
        <p className="text-muted-foreground px-2 py-1 text-xs">
          Apply measurement to layers
        </p>
        {[...new Set(["General", ...layers, ...value])].map((layer) => (
          <DropdownMenuCheckboxItem key={layer} checked={value.includes(layer)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              const next = checked ? [...value, layer] : value.filter(name => name !== layer);
              onChange(next.length ? next : ["General"]);
            }}>
            {layer}
          </DropdownMenuCheckboxItem>
        ))}
        {error && <p role="alert" className="px-2 text-sm text-destructive">{error}</p>}
        <form
          className="flex gap-2 border-t p-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next || saving) return;
            setSaving(true); setError("");
            try {
              await onAdd?.(next);
              onChange([...new Set([...value.filter(layer => layer !== "General"), next])]);
              setName("");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not save layer.");
            } finally { setSaving(false); }
          }}
        >
          <Input
            aria-label="New measurement layer"
            placeholder="New layer name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <Button type="submit" size="sm" disabled={!name.trim() || saving}>
            Add
          </Button>
        </form>
        <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(false)}>Done choosing layers</Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
