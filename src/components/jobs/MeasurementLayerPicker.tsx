"use client";
import { useState } from "react";
import { LayersIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "~/components/ui/dropdown-menu";

export function MeasurementLayerPicker({ value, layers, onChange }: {
  value: string; layers: string[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button type="button" size="sm" variant="outline" aria-label={`Measurement layer: ${value}`} title={`Layer: ${value}`} className="min-w-0 gap-1 px-1 text-xs">
        <LayersIcon className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">Layer</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end" className="w-64">
      <p className="px-2 py-1 text-xs text-muted-foreground">Save measurement to layer</p>
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {[...new Set(["General", ...layers, value])].map(layer => <DropdownMenuRadioItem key={layer} value={layer}>{layer}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <form className="flex gap-2 border-t p-2" onSubmit={event => {
        event.preventDefault();
        const next = name.trim();
        if (next) { onChange(next); setName(""); setOpen(false); }
      }}>
        <Input aria-label="New measurement layer" placeholder="New layer name" maxLength={80} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => event.stopPropagation()} />
        <Button type="submit" size="sm" disabled={!name.trim()}>Add</Button>
      </form>
    </DropdownMenuContent>
  </DropdownMenu>;
}
