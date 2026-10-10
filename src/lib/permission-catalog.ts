/**
 * Every permission an organization can grant or withhold, grouped for the
 * Organization page. Shared by the server (enforcement) and the client (UI).
 *
 * Stored per member in `users.permissionConfig` as
 *   { version: 2, permissions: { "jobs.create": true, ... } }
 * Live preset assignments keep this map current through a database trigger.
 * Keys missing from a stored map fall back to the account type's default.
 * Admins and Executive Accounts always have every permission.
 */

export const PERMISSION_GROUPS = [
  {
    id: "pages",
    label: "Pages",
    description: "Which tabs appear in the menu.",
    icon: "layout",
    permissions: [
      { key: "tab.dashboard", label: "Jobs", description: "Job list, material lists and rooms." },
      { key: "tab.catalogue", label: "Catalogue", description: "Browse the parts catalogue." },
      { key: "tab.suppliers", label: "Suppliers", description: "Supplier list and contacts." },
      { key: "tab.quotes", label: "Quotes", description: "View quotes sent to suppliers." },
      { key: "tab.orders", label: "Orders", description: "View orders and deliveries." },
      { key: "tab.draws", label: "Draws", description: "Progress billing. Shows contract values." },
      { key: "tab.timesheets", label: "Timesheets", description: "Record time and review submissions." },
      { key: "tab.assets", label: "Asset Management", description: "Tools and equipment." },
      { key: "tab.organization", label: "Organization", description: "This page." },
    ],
  },
  {
    id: "jobs",
    label: "Jobs",
    description: "Creating and maintaining jobs.",
    icon: "briefcase",
    permissions: [
      { key: "jobs.create", label: "Create jobs", description: "Start new jobs." },
      { key: "jobs.edit", label: "Edit jobs", description: "Rename jobs, change location, foreman and PO number." },
      { key: "jobs.delete", label: "Delete jobs", description: "Permanently delete a job and everything in it." },
    ],
  },
  {
    id: "lists",
    label: "Material lists",
    description: "Building lists of parts for a job.",
    icon: "list",
    permissions: [
      { key: "lists.edit", label: "Create & edit lists", description: "Make material lists and tool requests, add and change parts." },
      { key: "lists.delete", label: "Delete lists", description: "Permanently delete a material list." },
    ],
  },
  {
    id: "financial",
    label: "Dollar values",
    description: "Visibility of prices, costs and totals throughout the app.",
    icon: "receipt",
    permissions: [
      { key: "financial.view", label: "View dollar values", description: "Show dollar amounts in materials, catalogue, quotes, orders and billing. Turn off to hide all app dollar values for this member." },
    ],
  },
  {
    id: "purchasing",
    label: "Quotes & orders",
    description: "Spending money with suppliers.",
    icon: "cart",
    permissions: [
      { key: "quotes.create", label: "Request quotes", description: "Generate and email quote requests to suppliers." },
      { key: "orders.send", label: "Send orders", description: "Generate and email purchase orders to suppliers." },
      { key: "orders.receive", label: "Check in deliveries", description: "Verify delivered quantities and add delivery notes." },
    ],
  },
  {
    id: "catalogue",
    label: "Parts catalogue",
    description: "The shared list of parts.",
    icon: "package",
    permissions: [
      { key: "parts.create", label: "Add parts", description: "Create new parts and custom parts." },
      { key: "parts.edit", label: "Edit parts", description: "Change names, sizes, images, groups and supplier links." },
      { key: "parts.delete", label: "Delete parts", description: "Remove parts from the catalogue." },
    ],
  },
  {
    id: "suppliers",
    label: "Suppliers",
    description: "Who you buy from.",
    icon: "truck",
    permissions: [
      { key: "suppliers.edit", label: "Add & edit suppliers", description: "Create suppliers, edit contacts and supplier part numbers." },
      { key: "suppliers.delete", label: "Delete suppliers", description: "Remove suppliers and their part links." },
    ],
  },
  {
    id: "drawings",
    label: "Drawings",
    description: "Accessing and maintaining job drawings.",
    icon: "map",
    permissions: [
      { key: "drawings.view", label: "Access drawings card", description: "Show the Drawings card and open drawing folders, sheets and their workspace." },
      { key: "drawings.upload", label: "Upload drawings", description: "Upload drawing PDFs, create folders and rename drawings and floors. Does not allow deleting drawings." },
      { key: "drawings.delete", label: "Delete drawings", description: "Delete drawing sheets, drawing folders and uploaded floor plans." },
    ],
  },
  {
    id: "rooms",
    label: "Rooms",
    description: "Room detection and review.",
    icon: "map",
    permissions: [
      { key: "rooms.review", label: "Review rooms", description: "Approve, reject, draw and edit rooms; confirm floors." },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    description: "Job files, revisions and document control.",
    icon: "list",
    permissions: [
      { key: "documents.manage", label: "Manage documents", description: "Upload and organize documents, manage versions and reviews, and prepare transmittals. Folder permissions can restrict access further." },
    ],
  },
  {
    id: "draws",
    label: "Draws",
    description: "Progress billing to the owner/GC.",
    icon: "receipt",
    permissions: [
      { key: "draws.edit", label: "Edit draws", description: "Set up schedules of values and create, submit and close draws." },
    ],
  },
  {
    id: "tools",
    label: "Tool room",
    description: "Asset Management back office.",
    icon: "wrench",
    permissions: [
      { key: "assets.manage", label: "Tool room", description: "Add tools, fill tool requests, check tools in and out, run counts." },
    ],
  },
  {
    id: "timesheets", label: "Timesheets", description: "Recording time and approving submissions.", icon: "list",
    permissions: [
      { key: "timesheets.edit", label: "Record time", description: "Record, edit and submit your own hours, and use the time clock." },
      { key: "timesheets.manage", label: "Manage timesheets", description: "Review company timesheets, return or approve submissions, correct drafts and export reports." },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    description: "Company settings and people.",
    icon: "building",
    permissions: [
      { key: "org.members", label: "Manage members", description: "Approve people and change their permissions." },
      { key: "org.invite", label: "Invite people", description: "Create and revoke invite QR codes." },
      { key: "org.settings", label: "Company details", description: "Edit the company name and locations." },
    ],
  },
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];
export type PermissionKey = PermissionGroup["permissions"][number]["key"];
export type PermissionMap = Record<PermissionKey, boolean>;

export const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
) as PermissionKey[];

const all = (value: boolean) =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, value])) as PermissionMap;

/** Members without a paid seat and not admins (field staff). Matches the pre-2026-10 behaviour. */
export const STANDARD_DEFAULTS: PermissionMap = {
  ...all(false),
  "drawings.view": true,
  "financial.view": true,
  "tab.dashboard": true,
  "tab.catalogue": true,
  "tab.suppliers": true,
  "tab.quotes": true,
  "tab.orders": true,
  "tab.assets": true,
  "tab.timesheets": true,
  "timesheets.edit": true,
  "jobs.create": true,
  "jobs.edit": true,
  "lists.edit": true,
  "orders.receive": true,
  "parts.create": true,
  "parts.edit": true,
  "suppliers.edit": true,
};

/** Executive Accounts retain every capability; member overrides cannot revoke them. */
export const MANAGING_DEFAULTS: PermissionMap = {
  ...all(true),
};

export const PERMISSION_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  permissions: PermissionMap;
}> = [
  {
    id: "manager",
    label: "Manager",
    description: "Everything, including people and billing.",
    permissions: { ...all(true), "assets.manage": false },
  },
  {
    id: "foreman",
    label: "Foreman",
    description: "Runs jobs, orders material, reviews rooms. No deletes, billing or people.",
    permissions: {
      ...STANDARD_DEFAULTS,
      "lists.delete": true,
      "quotes.create": true,
      "orders.send": true,
      "drawings.upload": true,
      "drawings.delete": true,
      "documents.manage": true,
      "rooms.review": true,
      "timesheets.manage": true,
    },
  },
  {
    // Matches the "Journeyman" invite Tim set up (2026-10-05).
    id: "journeyman",
    label: "Journeyman",
    description:
      "Builds material lists, adds parts and checks in deliveries. Can't order, quote or delete.",
    permissions: {
      ...all(false),
      "drawings.view": true,
  "financial.view": true,
      "tab.dashboard": true,
      "tab.orders": true,
      "tab.timesheets": true,
      "timesheets.edit": true,
      "lists.edit": true,
      "parts.create": true,
      "parts.edit": true,
      "orders.receive": true,
    },
  },
  {
    id: "toolroom",
    label: "Tool room",
    description:
      "Builds lists and checks in deliveries, plus the Asset Management back office.",
    permissions: { ...STANDARD_DEFAULTS, "assets.manage": true },
  },
  {
    id: "viewonly",
    label: "View only",
    description: "Can look at jobs and lists but change nothing.",
    permissions: {
      ...all(false),
      "drawings.view": true,
  "financial.view": true,
      "tab.dashboard": true,
      "tab.catalogue": true,
      "tab.suppliers": true,
      "tab.orders": true,
    },
  },
];

/** Which preset a permission map matches exactly, if any. */
export function matchingPreset(map: PermissionMap) {
  return PERMISSION_PRESETS.find((preset) =>
    PERMISSION_KEYS.every((k) => preset.permissions[k] === map[k]),
  );
}

/** How long a new QR invite stays valid. */
export const INVITE_EXPIRY_DAYS = [1, 3, 7, 14, 30, 90] as const;
export type InviteExpiryDays = (typeof INVITE_EXPIRY_DAYS)[number];
export const DEFAULT_INVITE_EXPIRY_DAYS: InviteExpiryDays = 7;

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(value);
}
