"use client";

import { useEffect, useState } from "react";
import { Building2Icon, Loader2Icon, MapPinIcon, SaveIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { notify } from "~/components/ui/app-dialogs";
import { api, type RouterOutputs } from "~/trpc/react";

type Settings = RouterOutputs["organization"]["getOrganizationSettings"];
type Location = Settings["locations"][number];
type LocationForm = { name: string; address1: string; address2: string; city: string; region: string; postalCode: string; country: string; notes: string };

const toForm = (l: Location): LocationForm => ({
  name: l.name,
  address1: l.address1 ?? "",
  address2: l.address2 ?? "",
  city: l.city ?? "",
  region: l.region ?? "",
  postalCode: l.postalCode ?? "",
  country: l.country ?? "",
  notes: l.notes ?? "",
});

export function CompanySection({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const canEdit = settings.viewer.canEditSettings;
  const [name, setName] = useState(settings.organization.name);
  useEffect(() => setName(settings.organization.name), [settings.organization.name]);
  const update = api.organization.updateOrganization.useMutation({
    onSuccess: async () => {
      await onSaved();
      notify("Company name saved.", "success");
    },
  });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Building2Icon className="h-5 w-5 text-primary" /> Company
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <label htmlFor="org-name" className="text-sm font-medium">Company name</label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit || update.isPending} />
          </div>
          <Button disabled={!canEdit || !name.trim() || name.trim() === settings.organization.name || update.isPending} onClick={() => update.mutate({ name: name.trim() })}>
            {update.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
            Save
          </Button>
        </div>
        {update.error && <p className="mt-2 text-sm text-destructive">{update.error.message}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Created {new Date(settings.organization.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} · ID {settings.organization.id}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MapPinIcon className="h-5 w-5 text-primary" /> Locations
        </h2>
        {settings.locations.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No locations yet. They&apos;re added when you set a job&apos;s address.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {settings.locations.map((l) => (
              <LocationCard key={l.id} location={l} canEdit={canEdit} onSaved={onSaved} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LocationCard({ location, canEdit, onSaved }: { location: Location; canEdit: boolean; onSaved: () => Promise<void> }) {
  const original = toForm(location);
  const [form, setForm] = useState(original);
  const [editing, setEditing] = useState(false);
  const save = api.organization.updateLocation.useMutation({
    onSuccess: async () => {
      setEditing(false);
      await onSaved();
    },
  });
  const changed = (Object.keys(form) as Array<keyof LocationForm>).some((k) => form[k] !== original[k]);
  const field = (key: keyof LocationForm, label: string, className = "") => (
    <div className={`space-y-1 ${className}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} disabled={save.isPending} />
    </div>
  );
  const address = [original.address1, original.address2, [original.city, original.region].filter(Boolean).join(", "), original.postalCode, original.country].filter(Boolean).join(" · ");

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      {!editing ? (
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MapPinIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{original.name}</p>
            <p className="text-sm text-muted-foreground">{address || "No address"}</p>
            {original.notes && <p className="mt-1 text-xs text-muted-foreground">{original.notes}</p>}
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("name", "Name", "sm:col-span-2")}
            {field("address1", "Address")}
            {field("address2", "Address line 2")}
            {field("city", "City")}
            {field("region", "Province / state")}
            {field("postalCode", "Postal code")}
            {field("country", "Country")}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={save.isPending} />
          </div>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setForm(original);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button disabled={!changed || !form.name.trim() || save.isPending} onClick={() => save.mutate({ id: location.id, ...form, name: form.name.trim() })}>
              Save location
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
