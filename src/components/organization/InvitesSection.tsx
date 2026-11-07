"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  QrCodeIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { confirmAction } from "~/components/ui/app-dialogs";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  INVITE_EXPIRY_DAYS,
  PERMISSION_PRESETS,
  STANDARD_DEFAULTS,
  matchingPreset,
  type InviteExpiryDays,
  type PermissionMap,
} from "~/lib/permission-catalog";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import { PermissionEditor, roleLabel } from "./PermissionEditor";

type Settings = RouterOutputs["organization"]["getOrganizationSettings"];
type Invite = Settings["invites"][number];

const PUBLIC_APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://foremanhq.stellarator.work"
).replace(/\/+$/, "");
// New invites start as a Journeyman unless another preset is picked.
const JOURNEYMAN = PERMISSION_PRESETS.find(
  (p) => p.id === "journeyman",
)!.permissions;
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
  const config = invite.permissionConfig as {
    version?: number;
    permissions?: Partial<PermissionMap>;
  } | null;
  if (config?.version === 2 && config.permissions)
    return { ...STANDARD_DEFAULTS, ...config.permissions };
  return null;
}

export function InvitesSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<PermissionMap>(JOURNEYMAN);
  const [expiresInDays, setExpiresInDays] = useState<InviteExpiryDays>(
    DEFAULT_INVITE_EXPIRY_DAYS,
  );
  // "Custom" stays selected once a permission is changed by hand.
  const [custom, setCustom] = useState(false);
  const selectedPreset = custom
    ? "custom"
    : (matchingPreset(perms)?.id ?? "custom");
  const create = api.organization.createOrganizationInvite.useMutation({
    onSuccess: async () => {
      setName("");
      await onSaved();
    },
  });
  const canInvite = settings.viewer.canInvite;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="bg-card h-fit rounded-2xl border p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <QrCodeIcon className="text-primary h-5 w-5" /> New invite
        </h2>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="invite-name" className="text-sm font-medium">
              Invite name
            </label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shop crew"
              disabled={!canInvite}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Expires after</p>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Invite expiry"
            >
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
                    expiresInDays === days
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  {EXPIRY_LABELS[days]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Starts as</p>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Starts as"
            >
              {[
                ...PERMISSION_PRESETS.map((p) => ({
                  id: p.id,
                  label: p.label,
                })),
                { id: "custom", label: "Custom" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedPreset === option.id}
                  disabled={!canInvite}
                  onClick={() => {
                    const preset = PERMISSION_PRESETS.find(
                      (p) => p.id === option.id,
                    );
                    if (preset) setPerms(preset.permissions);
                    setCustom(!preset);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    selectedPreset === option.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <PermissionEditor
            value={perms}
            onChange={(next) => {
              setPerms(next);
              setCustom(true);
            }}
            disabled={!canInvite}
            showPresets={false}
          />
          {create.error && (
            <p className="text-destructive text-sm">{create.error.message}</p>
          )}
          <Button
            className="w-full"
            disabled={!canInvite || !name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                permissions: perms,
                expiresInDays,
              })
            }
          >
            {create.isPending ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <QrCodeIcon className="h-4 w-4" />
            )}
            Create QR invite
          </Button>
          {!canInvite && (
            <p className="text-muted-foreground text-xs">
              You don&apos;t have permission to invite people.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Active invites{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({settings.invites.length})
          </span>
        </h2>
        {settings.invites.length === 0 ? (
          <div className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">
            <QrCodeIcon className="mx-auto mb-2 h-8 w-8" /> No active invites.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {settings.invites.map((invite) => (
              <InviteCard
                key={invite.id}
                invite={invite}
                perms={invitePermissions(invite)}
                canRevoke={canInvite}
                onSaved={onSaved}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InviteCard({
  invite,
  perms,
  canRevoke,
  onSaved,
}: {
  invite: Invite;
  perms: PermissionMap | null;
  canRevoke: boolean;
  onSaved: () => Promise<void>;
}) {
  const link = `${PUBLIC_APP_URL}/join/${invite.token}`;
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const revoke = api.organization.revokeOrganizationInvite.useMutation({
    onSuccess: onSaved,
  });
  useEffect(() => {
    QRCode.toDataURL(link, { width: 200, margin: 1, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => setQr(""));
  }, [link]);
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 86_400_000),
  );

  return (
    <div className="bg-card flex gap-4 rounded-2xl border p-4 shadow-sm">
      <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl border bg-white p-1.5">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR invite for ${invite.name ?? "organization"}`}
            className="h-full w-full"
          />
        ) : (
          <QrCodeIcon className="text-muted-foreground h-10 w-10" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate font-semibold">{invite.name ?? "Invite"}</p>
        <p className="text-muted-foreground text-xs">
          {perms ? roleLabel(perms) : "Older invite"} · expires in {daysLeft}{" "}
          day{daysLeft === 1 ? "" : "s"}
        </p>
        <p className="bg-muted text-muted-foreground mt-2 truncate rounded-md px-2 py-1 font-mono text-[11px]">
          {link}
        </p>
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
            {copied ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {canRevoke && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={revoke.isPending}
              onClick={async () => {
                if (
                  await confirmAction({
                    title: `Revoke "${invite.name ?? "invite"}"?`,
                    description:
                      "The QR code and link stop working immediately.",
                    confirmLabel: "Revoke",
                    destructive: true,
                  })
                )
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
