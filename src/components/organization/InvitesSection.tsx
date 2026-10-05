"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CheckIcon, ChevronDownIcon, CopyIcon, Loader2Icon, QrCodeIcon, Trash2Icon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { confirmAction } from "~/components/ui/app-dialogs";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  INVITE_EXPIRY_DAYS,
  PERMISSION_PRESETS,
  STANDARD_DEFAULTS,
  type InviteExpiryDays,
  type PermissionMap,
} from "~/lib/permission-catalog";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import { PermissionEditor, roleLabel } from "./PermissionEditor";

type Settings = RouterOutputs["organization"]["getOrganizationSettings"];
type Invite = Settings["invites"][number];

const PUBLIC_APP_URL = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://foremanhq.stellarator.work").replace(/\/+$/, "");
// New invites start as a Journeyman unless another preset is picked.
const JOURNEYMAN = PERMISSION_PRESETS.find((p) => p.id === "journeyman")!.permissions;
const EXPIRY_LABELS: Record<InviteExpiryDays, string> = {
  1: "1 day",
  3: "3 days",
  7: "1 week",
  14: "2 weeks",
  30: "30 days",
  90: "90 days",
};

/** Invite permissions in either stored format, as a full map for display. */
function invitePermissions(invite: Invite): PermissionMap | null {
  const config = invite.permissionConfig as { version?: number; permissions?: Partial<PermissionMap> } | null;
  if (config?.version === 2 && config.permissions) return { ...STANDARD_DEFAULTS, ...config.permissions };
  return null;
}

export function InvitesSection({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<PermissionMap>(JOURNEYMAN);
  const [expiresInDays, setExpiresInDays] = useState<InviteExpiryDays>(DEFAULT_INVITE_EXPIRY_DAYS);
  const [showAll, setShowAll] = useState(false);
  const create = api.organization.createOrganizationInvite.useMutation({
    onSuccess: async () => {
      setName("");
      await onSaved();
    },
  });
  const canInvite = settings.viewer.canInvite;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="h-fit rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <QrCodeIcon className="h-5 w-5 text-primary" /> New invite
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Make a QR code for a crew. Anyone who scans it joins with these permissions, then waits for your approval.
        </p>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="invite-name" className="text-sm font-medium">Invite name</label>
            <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shop crew" disabled={!canInvite} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Starts as</p>
            <div className="flex flex-wrap gap-2">
              {PERMISSION_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!canInvite}
                  onClick={() => setPerms(p.permissions)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    roleLabel(perms) === p.label ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Expires after</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Invite expiry">
              {INVITE_EXPIRY_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  role="radio"
                  aria-checked={expiresInDays === days}
                  disabled={!canInvite}
                  onClick={() => setExpiresInDays(days)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    expiresInDays === days ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {EXPIRY_LABELS[days]}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            <ChevronDownIcon className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} />
            {showAll ? "Hide permissions" : "Customize permissions"}
          </button>
          {showAll && <PermissionEditor value={perms} onChange={setPerms} disabled={!canInvite} />}
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          <Button className="w-full" disabled={!canInvite || !name.trim() || create.isPending} onClick={() => create.mutate({ name: name.trim(), permissions: perms, expiresInDays })}>
            {create.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <QrCodeIcon className="h-4 w-4" />}
            Create QR invite
          </Button>
          {!canInvite && <p className="text-xs text-muted-foreground">You don&apos;t have permission to invite people.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Active invites <span className="text-sm font-normal text-muted-foreground">({settings.invites.length})</span>
        </h2>
        {settings.invites.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            <QrCodeIcon className="mx-auto mb-2 h-8 w-8" /> No active invites.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {settings.invites.map((invite) => (
              <InviteCard key={invite.id} invite={invite} perms={invitePermissions(invite)} canRevoke={canInvite} onSaved={onSaved} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InviteCard({ invite, perms, canRevoke, onSaved }: { invite: Invite; perms: PermissionMap | null; canRevoke: boolean; onSaved: () => Promise<void> }) {
  const link = `${PUBLIC_APP_URL}/join/${invite.token}`;
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const revoke = api.organization.revokeOrganizationInvite.useMutation({ onSuccess: onSaved });
  useEffect(() => {
    QRCode.toDataURL(link, { width: 200, margin: 1, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(""));
  }, [link]);
  const daysLeft = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 86_400_000));

  return (
    <div className="flex gap-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl border bg-white p-1.5">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR invite for ${invite.name ?? "organization"}`} className="h-full w-full" />
        ) : (
          <QrCodeIcon className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate font-semibold">{invite.name ?? "Invite"}</p>
        <p className="text-xs text-muted-foreground">
          {perms ? roleLabel(perms) : "Older invite"} · expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}
        </p>
        <p className="mt-2 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">{link}</p>
        <div className="mt-auto flex gap-2 pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {canRevoke && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={revoke.isPending}
              onClick={async () => {
                if (await confirmAction({ title: `Revoke "${invite.name ?? "invite"}"?`, description: "The QR code and link stop working immediately.", confirmLabel: "Revoke", destructive: true }))
                  revoke.mutate({ id: invite.id });
              }}
            >
              <Trash2Icon className="h-4 w-4" /> Revoke
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
