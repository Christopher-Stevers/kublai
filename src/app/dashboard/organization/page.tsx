"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Building2Icon,
  CopyIcon,
  Loader2Icon,
  MapPinIcon,
  PercentIcon,
  QrCodeIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";

import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useOnlineStatus } from "~/hooks/use-online-status";

const PUBLIC_APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "https://foremanhq.stellarator.work"
).replace(/\/+$/, "");

type OrganizationSettings =
  RouterOutputs["organization"]["getOrganizationSettings"];
type PricingProfile = OrganizationSettings["pricingProfiles"][number];
type Location = OrganizationSettings["locations"][number];
type OrganizationInvite = OrganizationSettings["invites"][number];
type OrganizationMember = OrganizationSettings["members"][number];

type PricingProfileForm = {
  name: string;
  defaultMarkupPercent: string;
};

type LocationForm = {
  name: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
};

type InvitePermissions = {
  tabs: {
    dashboard: boolean;
    catalogue: boolean;
    suppliers: boolean;
    quotes: boolean;
    orders: boolean;
  };
  actions: {
    canCreateParts: boolean;
    canEditParts: boolean;
    canDeleteParts: boolean;
    canDelete: boolean;
  };
};

type AccessStatus = "approved" | "pending" | "denied";

const defaultInvitePermissions: InvitePermissions = {
  tabs: {
    dashboard: true,
    catalogue: true,
    suppliers: true,
    quotes: true,
    orders: true,
  },
  actions: {
    canCreateParts: true,
    canEditParts: true,
    canDeleteParts: false,
    canDelete: false,
  },
};

const tabOptions = [
  { id: "dashboard", label: "Dashboard" },
  { id: "catalogue", label: "Catalogue" },
  { id: "suppliers", label: "Suppliers" },
  { id: "quotes", label: "Quotes" },
  { id: "orders", label: "Orders" },
] as const;

const actionOptions = [
  { id: "canCreateParts", label: "Can Create Parts" },
  { id: "canEditParts", label: "Can Edit Parts" },
  { id: "canDeleteParts", label: "Can Delete Parts" },
] as const;

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toPricingProfileForm(profile: PricingProfile): PricingProfileForm {
  return {
    name: profile.name,
    defaultMarkupPercent: Number(profile.defaultMarkupPercent).toString(),
  };
}

function toLocationForm(location: Location): LocationForm {
  return {
    name: location.name,
    address1: location.address1 ?? "",
    address2: location.address2 ?? "",
    city: location.city ?? "",
    region: location.region ?? "",
    postalCode: location.postalCode ?? "",
    country: location.country ?? "",
    notes: location.notes ?? "",
  };
}

function invitePermissionsFromUnknown(input: unknown): InvitePermissions {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaultInvitePermissions;
  }

  const raw = input as Partial<InvitePermissions>;
  return {
    tabs: {
      ...defaultInvitePermissions.tabs,
      ...(raw.tabs ?? {}),
    },
    actions: {
      ...defaultInvitePermissions.actions,
      ...(raw.actions ?? {}),
    },
  };
}

function OrganizationInviteCard({
  invite,
  onRevoke,
  isRevoking,
}: {
  invite: OrganizationInvite;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const [inviteLink, setInviteLink] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const permissions = invitePermissionsFromUnknown(invite.permissionConfig);

  useEffect(() => {
    const link = `${PUBLIC_APP_URL}/join/${invite.token}`;
    setInviteLink(link);

    QRCode.toDataURL(link, {
      width: 192,
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [invite.token]);

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid gap-4 rounded-md border border-gray-200 p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="flex min-h-48 items-center justify-center rounded-md bg-white">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`${invite.name ?? "Organization"} invite QR code`}
            className="h-48 w-48"
          />
        ) : (
          <QrCodeIcon className="h-16 w-16 text-gray-300" />
        )}
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">
            {invite.name ?? "Organization Invite"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">
              Expires {formatDate(invite.expiresAt)}
            </span>
          </div>
          <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm break-all text-gray-700">
            {inviteLink}
          </p>
          <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
            <div>
              <p className="font-medium text-gray-900">Tabs</p>
              <p>
                {tabOptions
                  .filter((option) => permissions.tabs[option.id])
                  .map((option) => option.label)
                  .join(", ") || "None"}
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-900">Actions</p>
              <p>
                {actionOptions
                  .filter((option) => permissions.actions[option.id])
                  .map((option) => option.label)
                  .join(", ") || "None"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyLink()}
            disabled={!inviteLink}
          >
            <CopyIcon className="h-4 w-4" />
            {copied ? "Copied" : "Copy Link"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onRevoke}
            disabled={isRevoking}
          >
            <Trash2Icon className="h-4 w-4" />
            Revoke
          </Button>
        </div>
      </div>
    </div>
  );
}

function MemberPermissionEditor({
  member,
  permissions,
  status,
  onStatusChange,
  onTabChange,
  onActionChange,
  onSave,
  isSaving,
}: {
  member: OrganizationMember;
  permissions: InvitePermissions;
  status: AccessStatus;
  onStatusChange: (status: AccessStatus) => void;
  onTabChange: (tab: keyof InvitePermissions["tabs"], checked: boolean) => void;
  onActionChange: (
    action: keyof InvitePermissions["actions"],
    checked: boolean,
  ) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 rounded-md border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">
            {member.name || member.email}
          </p>
          <p className="truncate text-xs text-gray-500">{member.email}</p>
          <p className="mt-1 text-xs text-gray-500">
            {member.permissions.accountTypeLabel}
          </p>
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`member-status-${member.id}`}
            className="text-xs font-medium text-gray-700"
          >
            Access
          </label>
          <select
            id={`member-status-${member.id}`}
            value={status}
            onChange={(event) =>
              onStatusChange(event.target.value as AccessStatus)
            }
            disabled={isSaving}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-white px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">Tabs</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {tabOptions.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={permissions.tabs[option.id]}
                  onChange={(event) =>
                    onTabChange(option.id, event.target.checked)
                  }
                  disabled={isSaving}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">Actions</p>
          <div className="grid gap-2">
            {actionOptions.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={permissions.actions[option.id]}
                  onChange={(event) =>
                    onActionChange(option.id, event.target.checked)
                  }
                  disabled={isSaving}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onSave}
        disabled={isSaving}
      >
        {isSaving ? "Saving..." : "Save Member"}
      </Button>
    </div>
  );
}

export default function OrganizationPage() {
  const isOnline = useOnlineStatus();
  const utils = api.useUtils();
  const [organizationName, setOrganizationName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePermissions, setInvitePermissions] = useState<InvitePermissions>(
    defaultInvitePermissions,
  );
  const [memberPermissions, setMemberPermissions] = useState<
    Record<string, InvitePermissions>
  >({});
  const [memberStatuses, setMemberStatuses] = useState<
    Record<string, AccessStatus>
  >({});
  const [pricingForms, setPricingForms] = useState<
    Record<string, PricingProfileForm>
  >({});
  const [locationForms, setLocationForms] = useState<
    Record<string, LocationForm>
  >({});

  const settings = api.organization.getOrganizationSettings.useQuery(
    undefined,
    {
      enabled: isOnline,
      retry: false,
    },
  );

  useEffect(() => {
    if (!settings.data) return;

    setOrganizationName(settings.data.organization.name);
    setPricingForms(
      Object.fromEntries(
        settings.data.pricingProfiles.map((profile) => [
          profile.id,
          toPricingProfileForm(profile),
        ]),
      ),
    );
    setLocationForms(
      Object.fromEntries(
        settings.data.locations.map((location) => [
          location.id,
          toLocationForm(location),
        ]),
      ),
    );
    setMemberPermissions(
      Object.fromEntries(
        settings.data.members.map((member) => [
          member.id,
          invitePermissionsFromUnknown(member.permissionConfig),
        ]),
      ),
    );
    setMemberStatuses(
      Object.fromEntries(
        settings.data.members.map((member) => [
          member.id,
          member.organizationAccessStatus as AccessStatus,
        ]),
      ),
    );
  }, [settings.data]);

  const refreshSettings = async () => {
    await settings.refetch();
    await utils.organization.getOrganizationSettings.invalidate();
  };

  const updateOrganization = api.organization.updateOrganization.useMutation({
    onSuccess: refreshSettings,
  });

  const updatePricingProfile =
    api.organization.updatePricingProfile.useMutation({
      onSuccess: refreshSettings,
    });

  const updateLocation = api.organization.updateLocation.useMutation({
    onSuccess: refreshSettings,
  });
  const createInvite = api.organization.createOrganizationInvite.useMutation({
    onSuccess: async () => {
      setInviteName("");
      await refreshSettings();
    },
  });
  const revokeInvite = api.organization.revokeOrganizationInvite.useMutation({
    onSuccess: refreshSettings,
  });
  const updateMember = api.organization.updateOrganizationMember.useMutation({
    onSuccess: refreshSettings,
  });

  const canSaveOrganization =
    isOnline &&
    !!organizationName.trim() &&
    organizationName.trim() !== settings.data?.organization.name;

  const handlePricingChange = (
    id: string,
    field: keyof PricingProfileForm,
    value: string,
  ) => {
    setPricingForms((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { name: "", defaultMarkupPercent: "0" }),
        [field]: value,
      },
    }));
  };

  const handleLocationChange = (
    id: string,
    field: keyof LocationForm,
    value: string,
  ) => {
    setLocationForms((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          name: "",
          address1: "",
          address2: "",
          city: "",
          region: "",
          postalCode: "",
          country: "",
          notes: "",
        }),
        [field]: value,
      },
    }));
  };

  const handleInviteTabChange = (
    tab: keyof InvitePermissions["tabs"],
    checked: boolean,
  ) => {
    setInvitePermissions((current) => ({
      ...current,
      tabs: {
        ...current.tabs,
        [tab]: checked,
      },
    }));
  };

  const handleInviteActionChange = (
    action: keyof InvitePermissions["actions"],
    checked: boolean,
  ) => {
    setInvitePermissions((current) => ({
      ...current,
      actions: {
        ...current.actions,
        [action]: checked,
        ...(action === "canDeleteParts" ? { canDelete: checked } : {}),
      },
    }));
  };

  const handleMemberStatusChange = (memberId: string, status: AccessStatus) => {
    setMemberStatuses((current) => ({
      ...current,
      [memberId]: status,
    }));
  };

  const handleMemberTabChange = (
    memberId: string,
    tab: keyof InvitePermissions["tabs"],
    checked: boolean,
  ) => {
    setMemberPermissions((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] ?? defaultInvitePermissions),
        tabs: {
          ...(current[memberId]?.tabs ?? defaultInvitePermissions.tabs),
          [tab]: checked,
        },
      },
    }));
  };

  const handleMemberActionChange = (
    memberId: string,
    action: keyof InvitePermissions["actions"],
    checked: boolean,
  ) => {
    setMemberPermissions((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] ?? defaultInvitePermissions),
        actions: {
          ...(current[memberId]?.actions ?? defaultInvitePermissions.actions),
          [action]: checked,
          ...(action === "canDeleteParts" ? { canDelete: checked } : {}),
        },
      },
    }));
  };

  if (settings.isLoading && isOnline) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
            Organization
          </h1>
          <Card>
            <CardContent className="p-6 sm:p-8">
              <p className="text-center text-gray-600">Loading...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (settings.error) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
            Organization
          </h1>
          <Card>
            <CardContent className="p-6 sm:p-8">
              <p className="text-center text-gray-700">
                {settings.error.message}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const organization = settings.data?.organization;

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
          Organization
        </h1>

        <div className="space-y-6 sm:space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2Icon className="h-5 w-5" />
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                  Organization changes require internet.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-1">
                  <label
                    htmlFor="organization-name"
                    className="text-sm font-medium text-gray-900"
                  >
                    Name
                  </label>
                  <Input
                    id="organization-name"
                    value={organizationName}
                    onChange={(event) =>
                      setOrganizationName(event.target.value)
                    }
                    disabled={!isOnline || updateOrganization.isPending}
                  />
                </div>
                <Button
                  onClick={() =>
                    updateOrganization.mutate({ name: organizationName.trim() })
                  }
                  disabled={
                    !canSaveOrganization || updateOrganization.isPending
                  }
                >
                  {updateOrganization.isPending ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <SaveIcon className="h-4 w-4" />
                  )}
                  Save
                </Button>
              </div>

              {organization && (
                <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-gray-900">Organization ID</p>
                    <p className="mt-1 break-all text-gray-600">
                      {organization.id}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Created</p>
                    <p className="mt-1 text-gray-600">
                      {formatDate(organization.createdAt)}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2Icon className="h-5 w-5" />
                Accounts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.data?.members.length ? (
                settings.data.members.map((member) => {
                  const permissions =
                    memberPermissions[member.id] ??
                    invitePermissionsFromUnknown(member.permissionConfig);
                  const status =
                    memberStatuses[member.id] ??
                    (member.organizationAccessStatus as AccessStatus);

                  return (
                    <MemberPermissionEditor
                      key={member.id}
                      member={member}
                      permissions={permissions}
                      status={status}
                      onStatusChange={(nextStatus) =>
                        handleMemberStatusChange(member.id, nextStatus)
                      }
                      onTabChange={(tab, checked) =>
                        handleMemberTabChange(member.id, tab, checked)
                      }
                      onActionChange={(action, checked) =>
                        handleMemberActionChange(member.id, action, checked)
                      }
                      onSave={() =>
                        updateMember.mutate({
                          userId: member.id,
                          accessStatus: status,
                          permissions,
                        })
                      }
                      isSaving={updateMember.isPending}
                    />
                  );
                })
              ) : (
                <p className="text-sm text-gray-600">No accounts yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCodeIcon className="h-5 w-5" />
                QR Invites
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4 rounded-md border border-gray-200 p-4">
                <div className="space-y-1">
                  <label
                    htmlFor="organization-invite-name"
                    className="text-sm font-medium text-gray-900"
                  >
                    Name
                  </label>
                  <Input
                    id="organization-invite-name"
                    value={inviteName}
                    onChange={(event) => setInviteName(event.target.value)}
                    placeholder="Shop crew"
                    disabled={!isOnline || createInvite.isPending}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-900">Tabs</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {tabOptions.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 text-sm text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={invitePermissions.tabs[option.id]}
                            onChange={(event) =>
                              handleInviteTabChange(
                                option.id,
                                event.target.checked,
                              )
                            }
                            disabled={!isOnline || createInvite.isPending}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-900">Actions</p>
                    <div className="grid gap-2">
                      {actionOptions.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 text-sm text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={invitePermissions.actions[option.id]}
                            onChange={(event) =>
                              handleInviteActionChange(
                                option.id,
                                event.target.checked,
                              )
                            }
                            disabled={!isOnline || createInvite.isPending}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() =>
                    createInvite.mutate({
                      name: inviteName.trim(),
                      permissions: invitePermissions,
                    })
                  }
                  disabled={
                    !isOnline || !inviteName.trim() || createInvite.isPending
                  }
                >
                  {createInvite.isPending ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <QrCodeIcon className="h-4 w-4" />
                  )}
                  Generate QR
                </Button>
              </div>

              {settings.data?.invites.length ? (
                <div className="space-y-4">
                  {settings.data.invites.map((invite) => (
                    <OrganizationInviteCard
                      key={invite.id}
                      invite={invite}
                      onRevoke={() =>
                        revokeInvite.mutate({
                          id: invite.id,
                        })
                      }
                      isRevoking={revokeInvite.isPending}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-600">No active invites.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PercentIcon className="h-5 w-5" />
                Pricing Profiles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.data?.pricingProfiles.length ? (
                settings.data.pricingProfiles.map((profile) => {
                  const form =
                    pricingForms[profile.id] ?? toPricingProfileForm(profile);
                  const hasChanges =
                    form.name.trim() !== profile.name ||
                    Number(form.defaultMarkupPercent) !==
                      Number(profile.defaultMarkupPercent);

                  return (
                    <div
                      key={profile.id}
                      className="grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
                    >
                      <div className="space-y-1">
                        <label
                          htmlFor={`pricing-name-${profile.id}`}
                          className="text-sm font-medium text-gray-900"
                        >
                          Name
                        </label>
                        <Input
                          id={`pricing-name-${profile.id}`}
                          value={form.name}
                          onChange={(event) =>
                            handlePricingChange(
                              profile.id,
                              "name",
                              event.target.value,
                            )
                          }
                          disabled={!isOnline || updatePricingProfile.isPending}
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor={`pricing-markup-${profile.id}`}
                          className="text-sm font-medium text-gray-900"
                        >
                          Markup %
                        </label>
                        <Input
                          id={`pricing-markup-${profile.id}`}
                          type="number"
                          min="0"
                          max="999.999"
                          step="0.001"
                          value={form.defaultMarkupPercent}
                          onChange={(event) =>
                            handlePricingChange(
                              profile.id,
                              "defaultMarkupPercent",
                              event.target.value,
                            )
                          }
                          disabled={!isOnline || updatePricingProfile.isPending}
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={() =>
                          updatePricingProfile.mutate({
                            id: profile.id,
                            name: form.name.trim(),
                            defaultMarkupPercent: Number(
                              form.defaultMarkupPercent,
                            ),
                          })
                        }
                        disabled={
                          !isOnline ||
                          !hasChanges ||
                          !form.name.trim() ||
                          updatePricingProfile.isPending
                        }
                      >
                        Save
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-600">
                  No pricing profiles yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPinIcon className="h-5 w-5" />
                Locations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.data?.locations.length ? (
                settings.data.locations.map((location) => {
                  const form =
                    locationForms[location.id] ?? toLocationForm(location);
                  const original = toLocationForm(location);
                  const hasChanges = Object.entries(form).some(
                    ([key, value]) =>
                      value !== original[key as keyof LocationForm],
                  );

                  return (
                    <div
                      key={location.id}
                      className="space-y-4 rounded-md border border-gray-200 p-4"
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label
                            htmlFor={`location-name-${location.id}`}
                            className="text-sm font-medium text-gray-900"
                          >
                            Name
                          </label>
                          <Input
                            id={`location-name-${location.id}`}
                            value={form.name}
                            onChange={(event) =>
                              handleLocationChange(
                                location.id,
                                "name",
                                event.target.value,
                              )
                            }
                            disabled={!isOnline || updateLocation.isPending}
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor={`location-address1-${location.id}`}
                            className="text-sm font-medium text-gray-900"
                          >
                            Address 1
                          </label>
                          <Input
                            id={`location-address1-${location.id}`}
                            value={form.address1}
                            onChange={(event) =>
                              handleLocationChange(
                                location.id,
                                "address1",
                                event.target.value,
                              )
                            }
                            disabled={!isOnline || updateLocation.isPending}
                          />
                        </div>
                        <div className="space-y-1">
                          <label
                            htmlFor={`location-address2-${location.id}`}
                            className="text-sm font-medium text-gray-900"
                          >
                            Address 2
                          </label>
                          <Input
                            id={`location-address2-${location.id}`}
                            value={form.address2}
                            onChange={(event) =>
                              handleLocationChange(
                                location.id,
                                "address2",
                                event.target.value,
                              )
                            }
                            disabled={!isOnline || updateLocation.isPending}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label
                              htmlFor={`location-city-${location.id}`}
                              className="text-sm font-medium text-gray-900"
                            >
                              City
                            </label>
                            <Input
                              id={`location-city-${location.id}`}
                              value={form.city}
                              onChange={(event) =>
                                handleLocationChange(
                                  location.id,
                                  "city",
                                  event.target.value,
                                )
                              }
                              disabled={!isOnline || updateLocation.isPending}
                            />
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor={`location-region-${location.id}`}
                              className="text-sm font-medium text-gray-900"
                            >
                              Region
                            </label>
                            <Input
                              id={`location-region-${location.id}`}
                              value={form.region}
                              onChange={(event) =>
                                handleLocationChange(
                                  location.id,
                                  "region",
                                  event.target.value,
                                )
                              }
                              disabled={!isOnline || updateLocation.isPending}
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label
                              htmlFor={`location-postal-${location.id}`}
                              className="text-sm font-medium text-gray-900"
                            >
                              Postal Code
                            </label>
                            <Input
                              id={`location-postal-${location.id}`}
                              value={form.postalCode}
                              onChange={(event) =>
                                handleLocationChange(
                                  location.id,
                                  "postalCode",
                                  event.target.value,
                                )
                              }
                              disabled={!isOnline || updateLocation.isPending}
                            />
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor={`location-country-${location.id}`}
                              className="text-sm font-medium text-gray-900"
                            >
                              Country
                            </label>
                            <Input
                              id={`location-country-${location.id}`}
                              value={form.country}
                              onChange={(event) =>
                                handleLocationChange(
                                  location.id,
                                  "country",
                                  event.target.value,
                                )
                              }
                              disabled={!isOnline || updateLocation.isPending}
                            />
                          </div>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label
                            htmlFor={`location-notes-${location.id}`}
                            className="text-sm font-medium text-gray-900"
                          >
                            Notes
                          </label>
                          <Textarea
                            id={`location-notes-${location.id}`}
                            value={form.notes}
                            onChange={(event) =>
                              handleLocationChange(
                                location.id,
                                "notes",
                                event.target.value,
                              )
                            }
                            disabled={!isOnline || updateLocation.isPending}
                            rows={3}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          onClick={() =>
                            updateLocation.mutate({
                              id: location.id,
                              ...form,
                              name: form.name.trim(),
                            })
                          }
                          disabled={
                            !isOnline ||
                            !hasChanges ||
                            !form.name.trim() ||
                            updateLocation.isPending
                          }
                        >
                          Save Location
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-600">No locations yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
