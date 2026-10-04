import type { ReadonlyJSONValue } from "replicache";
import type { ChatMessage } from "~/server/chat/contracts";

export const DEMO_JOB_ID = "10000000-0000-4000-8000-000000000001";
export const DEMO_FLOOR_ID = "10000000-0000-4000-8000-000000000002";
export const DEMO_ROOM_ID = "10000000-0000-4000-8000-000000000003";
export const DEMO_SUPPLIER_ID = "10000000-0000-4000-8000-000000000004";
export const DEMO_CATALOG_ID = "10000000-0000-4000-8000-000000000005";
export const DEMO_MATERIAL_ID = "10000000-0000-4000-8000-000000000006";
export const DEMO_CATEGORY_ID = "10000000-0000-4000-8000-000000000007";
export const DEMO_PART_ID = "10000000-0000-4000-8000-000000000008";
export const DEMO_UNIT_ID = "10000000-0000-4000-8000-000000000009";
export const DEMO_SUPPLIER_PART_ID = "10000000-0000-4000-8000-00000000000a";
export const DEMO_ORGANIZATION_ID = "10000000-0000-4000-8000-00000000000b";
const date = "2026-10-01T12:00:00.000Z";

export const demoJob = {
  id: DEMO_JOB_ID, name: "Riverside Community Centre", locationId: null,
  status: "active", foremanName: "Practice crew", poNumber: "DEMO-001",
  createdAt: date, updatedAt: date, location: null,
};
export const demoSupplier = {
  id: DEMO_SUPPLIER_ID, name: "Practice Plumbing Supply", contactName: "Sample supplier",
  contactEmail: null, contactPhone: null, contacts: [], orderingNotes: null,
  locationId: null, createdAt: date, updatedAt: date,
};
export const demoSupplierPart = {
  id: DEMO_SUPPLIER_PART_ID, supplierId: DEMO_SUPPLIER_ID, supplierSku: "DEMO-XFR-90-2",
  lastKnownUnitCost: "12.50", isPreferred: true,
  supplier: { id: DEMO_SUPPLIER_ID, name: demoSupplier.name },
};
export const demoCatalogue = {
  catalogs: [{ id: DEMO_CATALOG_ID, name: "Plumbing", kind: "materials", sortOrder: 0, organizationId: DEMO_ORGANIZATION_ID }],
  materials: [{ id: DEMO_MATERIAL_ID, name: "XFR", groupPath: ["PVC"] }],
  categories: [{ id: DEMO_CATEGORY_ID, name: "Fittings", sortOrder: 0, organizationId: DEMO_ORGANIZATION_ID }],
  allUnits: [{ id: DEMO_UNIT_ID, code: "in", displayName: "Inches", kind: "length" }],
  parts: [{
    id: DEMO_PART_ID, displayName: '2" XFR 90', description: "Practice fitting", imageUrl: null,
    material: "XFR", materialId: DEMO_MATERIAL_ID, size: '2"', sizeLabel: null,
    sizeNominal: "2", sizeUnit: "in", catalogId: DEMO_CATALOG_ID, categoryId: DEMO_CATEGORY_ID,
    sortOrder: 0, isOrgSpecific: false,
  }],
};

// A deliberately simple practice floor, not an architectural detection result.
const drawing = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700"><rect width="1000" height="700" fill="white"/><g fill="none" stroke="#111827" stroke-width="10"><rect x="80" y="100" width="840" height="500"/><path d="M500 100V420M80 420H920M700 420V600"/></g><g font-family="sans-serif" font-size="26" fill="#111827" text-anchor="middle"><text x="290" y="255">Mechanical room</text><text x="710" y="255">Meeting room</text><text x="385" y="515">Hallway</text><text x="810" y="515">Storage</text></g><text x="80" y="55" font-family="sans-serif" font-size="22" fill="#64748b">Practice drawing · Ground floor</text></svg>`;
export function createDemoRooms() {
  const roomDefinitions = [
    { id: DEMO_ROOM_ID, name: "Mechanical room", x: 0.08, y: 0.143, w: 0.42, h: 0.457 },
    { id: "10000000-0000-4000-8000-000000000011", name: "Meeting room", x: 0.5, y: 0.143, w: 0.42, h: 0.457 },
    { id: "10000000-0000-4000-8000-000000000012", name: "Hallway", x: 0.08, y: 0.6, w: 0.62, h: 0.257 },
    { id: "10000000-0000-4000-8000-000000000013", name: "Storage", x: 0.7, y: 0.6, w: 0.22, h: 0.257 },
  ];
  return {
    canManage: false, canEditNotes: true, canRequestMaterial: true,
    plan: { id: DEMO_FLOOR_ID, status: "ready", originalFilename: "Practice drawing", pageCount: 1, error: null },
    floors: [{
      id: DEMO_FLOOR_ID, jobId: DEMO_JOB_ID, floorPlanId: DEMO_FLOOR_ID,
      organizationId: DEMO_ORGANIZATION_ID, pageNumber: 1, name: "Ground floor",
      imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing)}`,
      width: 1000, height: 700, status: "confirmed", confirmedAt: new Date(date),
      completenessReviewedAt: new Date(date), createdAt: new Date(date), updatedAt: new Date(date),
      rooms: roomDefinitions.map(({ x, y, w, h, ...room }, index) => ({
        ...room, jobId: DEMO_JOB_ID, floorId: DEMO_FLOOR_ID, organizationId: DEMO_ORGANIZATION_ID,
        notes: "", notesRevision: 0, shape: { type: "bbox", x, y, w, h },
        source: "manual", confirmed: true, reviewStatus: "approved", detection: null,
        sortOrder: index, reviewPriority: 0, createdAt: new Date(date), updatedAt: new Date(date),
      })),
    }],
  };
}
export function createDemoMessages(): ChatMessage[] {
  return [{
    id: "10000000-0000-4000-8000-000000000021", sequence: 1, jobId: DEMO_JOB_ID,
    clientId: "10000000-0000-4000-8000-000000000022", body: "Welcome to the practice job. Try sending a message to the crew.",
    author: { id: "tutorial-crew", name: "Alex · Practice crew", image: null }, replyToId: null,
    createdAt: new Date(date), editedAt: null, deletedAt: null, attachments: [],
  }];
}
export const demoMaterialRecords: [string, ReadonlyJSONValue][] = [
  [`job/${DEMO_JOB_ID}`, demoJob], [`supplier/${DEMO_SUPPLIER_ID}`, demoSupplier],
];
export const demoCatalogueRecords: [string, ReadonlyJSONValue][] = [
  ...demoCatalogue.catalogs.map(value => [`catalog/${value.id}`, value] as [string, ReadonlyJSONValue]),
  ...demoCatalogue.materials.map(value => [`catalogueMaterial/${value.id}`, value] as [string, ReadonlyJSONValue]),
  ...demoCatalogue.categories.map(value => [`category/${value.id}`, value] as [string, ReadonlyJSONValue]),
  ...demoCatalogue.allUnits.map(value => [`unit/${value.id}`, value] as [string, ReadonlyJSONValue]),
  ...demoCatalogue.parts.map(value => [`cataloguePart/${value.id}`, value] as [string, ReadonlyJSONValue]),
];
