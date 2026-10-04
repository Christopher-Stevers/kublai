import { Replicache, dropDatabase, type ReadonlyJSONValue, type PullerResultV1 } from "replicache";
import { z } from "zod";
import { STANDARD_DEFAULTS } from "~/lib/permission-catalog";
import { makeMaterialListMutators, MATERIAL_LIST_INDEXES, type MaterialListReplicacheMutators } from "~/lib/replicache-material-list";
import type { TutorialSandbox } from "./tutorial-sandbox-context";
import {
  DEMO_JOB_ID, DEMO_ORGANIZATION_ID, DEMO_PART_ID,
  demoCatalogue, demoCatalogueRecords, demoMaterialRecords, demoSupplier, demoSupplierPart,
  createDemoMessages, createDemoRooms,
} from "./tutorial-sandbox-fixtures";

const httpRequestInfo = { httpStatusCode: 200, errorMessage: "" };
function seedPuller(records: [string, ReadonlyJSONValue][]) {
  let seeded = false;
  return () => {
    const response: PullerResultV1 = {
      httpRequestInfo,
      response: {
        cookie: 1, lastMutationIDChanges: {},
        patch: seeded ? [] : [{ op: "clear" }, ...records.map(([key, value]) => ({ op: "put" as const, key, value }))],
      },
    };
    seeded = true;
    return Promise.resolve(response);
  };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const string = (value: unknown) => typeof value === "string" ? value : "";
const jobInput = z.object({ jobId: z.literal(DEMO_JOB_ID) });

/** This local handler has no fetch/client fallback. Every unsupported call fails closed. */
export function createSandboxHandler(sandbox: TutorialSandbox) {
  const rooms = createDemoRooms();
  const messages = createDemoMessages();
  let muted = false;
  const getItems = (listId: string) => sandbox.material.query(async tx => {
    const list = await tx.get(`materialList/${listId}`);
    if (!list) throw new Error("Practice list not found");
    const items = (await tx.scan({ prefix: "materialListItem/" }).values().toArray()).map(record).filter(item => item.materialListId === listId);
    const materialList = record(list);
    const job = await tx.get(`job/${String(materialList.jobId)}`);
    return { materialList, items, job: record(job), materialTotal: items.reduce((sum, item) => sum + Number(item.extendedPrice ?? 0), 0), quote: { id: materialList.quoteId ?? listId } };
  });
  return async (path: string, value: unknown): Promise<unknown> => {
    const input = record(value);
    switch (path) {
      case "user.getMe": return { id: sandbox.userId, name: "You", email: "" };
      case "user.getMyRole": return {
        role: "user", organizationId: DEMO_ORGANIZATION_ID, hasOneTimeAccess: false,
        permissions: {
          role: "user", isAdmin: false, accountType: "standard", accountTypeLabel: "Practice account", isManagingAccount: false, isStandardAccount: true, isWorker: false,
          can: { ...STANDARD_DEFAULTS, "parts.create": false, "parts.edit": false },
          tabAccess: { dashboard: true, catalogue: true, suppliers: true, quotes: false, orders: false, draws: false, assets: false, organization: false },
          actionAccess: { canCreateParts: false, canEditParts: false, canDeleteParts: false, canDelete: false },
          canCreateParts: false, canEditParts: false, canDeleteParts: false, canManageAssets: false, canGenerateDocuments: false, canDeleteCoreRecords: false,
        },
      };
      case "rooms.getJobRooms": jobInput.parse(input); return structuredClone(rooms);
      case "rooms.updateNotes": {
        const args = z.object({ roomId: z.string(), notes: z.string().max(10000), expectedNotesRevision: z.number() }).parse(input);
        const room = rooms.floors.flatMap(floor => floor.rooms).find(room => room.id === args.roomId);
        if (!room) throw new Error("Practice room not found");
        if (args.expectedNotesRevision !== room.notesRevision) throw new Error("These practice notes changed. Reload them before saving.");
        room.notes = args.notes; room.notesRevision++;
        return { notes: room.notes, notesRevision: room.notesRevision };
      }
      case "chat.getOverview":
        jobInput.parse(input);
        return { joined: true, muted, userId: sandbox.userId, canModerate: false, unreadCount: 0, latestSequence: messages.length };
      case "chat.history":
        jobInput.parse(input);
        return { messages: structuredClone(messages.filter(message => !input.beforeSequence || message.sequence < Number(input.beforeSequence))), nextBeforeSequence: null, latestSequence: messages.length };
      case "chat.members":
        jobInput.parse(input);
        return [{ id: sandbox.userId, name: "You" }, { id: "tutorial-crew", name: "Alex · Practice crew" }];
      case "chat.join": case "chat.markRead": jobInput.parse(input); return { success: true };
      case "chat.setNotifications": jobInput.parse(input); muted = input.muted === true; return { muted };
      case "chat.send": {
        const args = jobInput.extend({ clientId: z.string().uuid(), body: z.string().trim().min(1).max(8000), replyToId: z.string().optional(), attachmentIds: z.array(z.string()).max(0).default([]) }).parse(input);
        const existing = messages.find(message => message.clientId === args.clientId);
        if (existing) return structuredClone(existing);
        const message = {
          id: crypto.randomUUID(), sequence: messages.length + 1, jobId: DEMO_JOB_ID, clientId: args.clientId, body: args.body,
          author: { id: sandbox.userId, name: "You", image: null }, replyToId: args.replyToId ?? null,
          createdAt: new Date(), editedAt: null, deletedAt: null, attachments: [],
        };
        messages.push(message);
        return structuredClone(message);
      }
      case "catalogue.getPartWizardSummary": return { ...structuredClone(demoCatalogue), partCount: demoCatalogue.parts.length };
      case "catalogue.searchParts":
        return structuredClone(demoCatalogue.parts.filter(part => (!input.catalogId || part.catalogId === input.catalogId) && (!input.materialId || part.materialId === input.materialId) && (!input.categoryId || part.categoryId === input.categoryId) && (!input.query || part.displayName.toLowerCase().includes(string(input.query).toLowerCase()))));
      case "catalogue.getPartsSupplierInfo": return Object.fromEntries((Array.isArray(input.partIds) ? input.partIds : []).filter(id => id === DEMO_PART_ID).map(id => [id, { preferredSupplier: demoSupplier, availableSuppliers: [demoSupplier] }]));
      case "supplier.getSupplierPartsByPart": return input.partDefinitionId === DEMO_PART_ID ? [structuredClone(demoSupplierPart)] : [];
      case "supplier.listSuppliers": case "supplier.getAll": return sandbox.material.query(async tx => tx.scan({ prefix: "supplier/" }).values().toArray());
      case "location.searchLocations": return [];
      case "materialList.getMaterialList": return getItems(string(input.materialListId));
      case "materialList.getQuotesForMaterialList": case "materialList.getOrdersForMaterialList": return [];
      case "job.getJob": {
        return sandbox.material.query(async tx => {
          const job = await tx.get(`job/${string(input.jobId)}`);
          if (!job) throw new Error("Practice job not found");
          return { ...record(job), materialLists: (await tx.scan({ prefix: "materialList/" }).values().toArray()).map(record).filter(list => list.jobId === input.jobId) };
        });
      }
      default: throw new Error(`This action is not available in the practice session (${path}). No changes were sent.`);
    }
  };
}

export type SandboxRuntime = TutorialSandbox & {
  request: ReturnType<typeof createSandboxHandler>;
  close: () => Promise<void>;
};

/** Fresh, memory-only stores never share identity or pending mutations with live data. */
export async function createTutorialSandbox(userId: string): Promise<SandboxRuntime> {
  const runId = crypto.randomUUID();
  const material = new Replicache<MaterialListReplicacheMutators>({
    name: `foremanhq-practice-material-${runId}`, kvStore: "mem", schemaVersion: "tutorial-v1",
    indexes: MATERIAL_LIST_INDEXES, mutators: makeMaterialListMutators(), pullInterval: null,
    puller: seedPuller(demoMaterialRecords), pusher: () => Promise.resolve({ httpRequestInfo }),
    logLevel: "error",
  });
  const catalogue = new Replicache({
    name: `foremanhq-practice-catalogue-${runId}`, kvStore: "mem", schemaVersion: "tutorial-v1",
    mutators: {}, pullInterval: null, puller: seedPuller(demoCatalogueRecords), pusher: () => Promise.resolve({ httpRequestInfo }),
    logLevel: "error",
  });
  const close = async () => {
    const names = [material.idbName, catalogue.idbName];
    await Promise.all([material.close(), catalogue.close()]);
    await Promise.all(names.map(name => dropDatabase(name, { kvStore: "mem" })));
  };
  try {
    await Promise.all([material.pull({ now: true }), catalogue.pull({ now: true })]);
    const ready = await material.query(tx => tx.has(`job/${DEMO_JOB_ID}`));
    if (!ready) throw new Error("Practice data could not initialize");
    const sandbox = { userId, material, catalogue, runId };
    return { ...sandbox, request: createSandboxHandler(sandbox), close };
  } catch (error) {
    await close();
    throw error;
  }
}
