// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  drawingLinkSchema,
  drawingMarkupSchema,
  drawingSaveSchema,
  type DrawingEntity,
  type DrawingJobSheet,
} from "~/lib/drawing-workspace";
import type { RequestUser } from "~/server/utils/get-request-identity";
import {
  addEntityComment,
  archiveEntity,
  assertRevision,
  canReadEntity,
  defaultDrawingMetadata,
  drawingActor,
  prepareEntity,
  type DrawingActor,
} from "./domain";
const sheetId = "00000000-0000-4000-8000-000000000001";
const source2 = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const now = "2026-10-07T12:00:00.000Z";
const worker: DrawingActor = {
  id: "worker",
  name: "Worker",
  canManage: false,
  organizationId: "org",
};
const other: DrawingActor = { ...worker, id: "other" };
const manager: DrawingActor = { ...worker, id: "manager", canManage: true };
const sheets: DrawingJobSheet[] = [sheetId, source2].map((id) => ({
  id,
  sheetId: id,
  setId: sheetId,
  name: "A101",
  imageUrl: "/drawing.png",
  width: 1000,
  height: 800,
  sourceFilename: "drawing.pdf",
}));
const markup = {
  sourceSheetId: sheetId,
  type: "line" as const,
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.7, y: 0.8 },
  ],
  stroke: "#ff0000",
  width: 2,
};
function input(overrides: Record<string, unknown> = {}) {
  return drawingSaveSchema.parse({
    sheetId,
    id,
    expectedRevision: 0,
    visibility: "private",
    kind: "markup",
    data: markup,
    ...overrides,
  });
}
function create(overrides: Record<string, unknown> = {}, actor = worker) {
  return prepareEntity(
    input(overrides),
    null,
    actor,
    sheets,
    ["worker", "other", "manager"],
    now,
  );
}
function issue() {
  return create({
    visibility: "published",
    kind: "issue",
    data: {
      sourceSheetId: sheetId,
      type: "rfi",
      point: { x: 0.2, y: 0.3 },
      title: "Beam clearance",
      body: "Please confirm",
      assigneeId: "other",
    },
  });
}

describe("drawing workspace authorization and revisions", () => {
  it("preserves saved measuring branches and scale through creation and editing", () => {
    const measurement = {
      ...markup,
      type: "dimension",
      unit: "ft",
      scale: 100,
      stroke: "#00ffff",
      points: [
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.2 },
      ],
      parents: [null, 2, 0, 2],
    };
    const saved = create({ data: measurement });
    expect(saved).toMatchObject({
      kind: "markup",
      revision: 1,
      authorId: worker.id,
      data: measurement,
    });
    const update = prepareEntity(
      input({
        expectedRevision: saved.revision,
        data: { ...measurement, stroke: "#ff00ff" },
      }),
      saved,
      worker,
      sheets,
      [],
      now,
    );
    expect(update).toMatchObject({
      revision: 2,
      data: {
        parents: measurement.parents,
        unit: "ft",
        scale: 100,
        stroke: "#ff00ff",
      },
    });
  });

  it("requires same organization, approved access, and dashboard permission", () => {
    const user = {
      id: "worker",
      name: "Test",
      organizationId: "org",
      role: "worker",
      organizationAccessStatus: "approved",
      permissionConfig: null,
    } as RequestUser;
    expect(drawingActor(user, "org").canManage).toBe(false);
    expect(() => drawingActor({ ...user, permissionConfig: { version: 2, permissions: { "drawings.view": false, "drawings.upload": true } } }, "org")).toThrow(/drawing access/);
    expect(() => drawingActor(null, "org")).toThrow();
    expect(() => drawingActor(user, "another org")).toThrow(
      /Drawing not found/,
    );
    expect(() =>
      drawingActor({ ...user, organizationAccessStatus: "pending" }, "org"),
    ).toThrow(/Approved/);
    expect(() =>
      drawingActor(
        {
          ...user,
          permissionConfig: {
            version: 2,
            permissions: { "tab.dashboard": false },
          },
        },
        "org",
      ),
    ).toThrow(/Approved/);
  });
  it("keeps private work unreadable and uneditable by other users, including managers", () => {
    const entity = create();
    expect(canReadEntity(entity, worker)).toBe(true);
    expect(canReadEntity(entity, other)).toBe(false);
    expect(canReadEntity(entity, manager)).toBe(false);
    for (const actor of [other, manager])
      expect(() =>
        prepareEntity(
          input({ expectedRevision: 1 }),
          entity,
          actor,
          sheets,
          [],
          now,
        ),
      ).toThrow(/not found/);
  });
  it("prevents publishing markup without drawings.upload", () => {
    expect(() => create({ visibility: "published" })).toThrow(
      /management permission/,
    );
    expect(create({ visibility: "published" }, manager).visibility).toBe(
      "published",
    );
  });
  it("retains original authorship when a manager edits published work", () => {
    const original = create({ visibility: "published" }, manager);
    const anotherManager = { ...manager, id: "manager2" };
    const update = prepareEntity(
      input({
        expectedRevision: 1,
        visibility: "published",
        data: { ...markup, text: "edited" },
      }),
      original,
      anotherManager,
      sheets,
      [],
      now,
    );
    expect(update).toMatchObject({
      authorId: manager.id,
      revision: 2,
      data: { text: "edited" },
    });
  });
  it("rejects stale revisions rather than overwriting concurrent changes", () => {
    const original = create();
    const update = prepareEntity(
      input({ expectedRevision: 1, data: { ...markup, text: "first device" } }),
      original,
      worker,
      sheets,
      [],
      now,
    );
    expect(() =>
      prepareEntity(
        input({
          expectedRevision: 1,
          data: { ...markup, text: "second device" },
        }),
        update,
        worker,
        sheets,
        [],
        now,
      ),
    ).toThrow(/Someone changed/);
    expect(update.data).toHaveProperty("text", "first device");
    expect(() => assertRevision(2, 0)).toThrow(/Someone changed/);
  });
  it("rejects another job's source or hyperlink target", () => {
    const unknown = "00000000-0000-4000-8000-000000000099";
    expect(() =>
      create({ data: { ...markup, sourceSheetId: unknown } }),
    ).toThrow(/in this job/);
    expect(() =>
      create({
        data: {
          ...markup,
          type: "link",
          links: [{ label: "Missing sheet", targetSheetId: unknown }],
        },
      }),
    ).toThrow(/in this job/);
    const linked = create({
      data: {
        ...markup,
        type: "link",
        linkAppearance: "highlight",
        links: [
          { label: "Drawing", targetSheetId: source2 },
          { label: "Chat", url: `/dashboard/jobs/${sheetId}/chat` },
        ],
      },
    });
    if (linked.kind !== "markup") throw Error("fixture");
    expect(linked.data.linkAppearance).toBe("highlight");
    expect(linked.data.links).toEqual([
      { label: "Drawing", targetSheetId: source2 },
      { label: "Chat", url: `/dashboard/jobs/${sheetId}/chat` },
    ]);
    expect(() =>
      create({ data: { ...markup, targetSheetId: unknown } }),
    ).toThrow(/in this job/);
  });
  it("prevents moving annotations or changing their type after creation", () => {
    const original = create();
    expect(() =>
      prepareEntity(
        input({
          expectedRevision: 1,
          data: { ...markup, sourceSheetId: source2 },
        }),
        original,
        worker,
        sheets,
        [],
        now,
      ),
    ).toThrow(/cannot move/);
    expect(() =>
      prepareEntity(
        input({
          expectedRevision: 1,
          kind: "view",
          data: {
            sourceSheetId: sheetId,
            name: "view",
            center: { x: 0.5, y: 0.5 },
            zoom: 2,
          },
        }),
        original,
        worker,
        sheets,
        [],
        now,
      ),
    ).toThrow(/type cannot change/);
  });
  it("allows field workers to publish an issue and its assignee to answer", () => {
    const original = issue();
    expect(original.kind).toBe("issue");
    expect(() => archiveEntity(original, other, 1, now)).toThrow(
      /archive this item/,
    );
    if (original.kind !== "issue") throw new Error("fixture");
    const update = prepareEntity(
      input({
        kind: "issue",
        visibility: "published",
        expectedRevision: 1,
        data: { ...original.data, body: "Confirmed", status: "answered" },
      }),
      original,
      other,
      sheets,
      ["other"],
      now,
    );
    expect(update).toMatchObject({
      authorId: worker.id,
      data: { status: "answered", body: "Confirmed" },
    });
    expect(() =>
      prepareEntity(
        input({
          kind: "issue",
          visibility: "published",
          expectedRevision: 1,
          data: { ...original.data, title: "Hijacked" },
        }),
        original,
        other,
        sheets,
        ["other"],
        now,
      ),
    ).toThrow(/Assignees can update/);
  });
  it("does not allow an unassigned worker to edit another person's issue", () => {
    const original = issue();
    expect(() =>
      prepareEntity(
        input({
          kind: "issue",
          visibility: "published",
          expectedRevision: 1,
          data: original.data,
        }),
        original,
        { ...worker, id: "stranger" },
        sheets,
        ["other"],
        now,
      ),
    ).toThrow(/Only the author/);
  });
  it("rejects cross-organization assignees", () => {
    expect(() =>
      create({
        kind: "issue",
        data: {
          sourceSheetId: sheetId,
          type: "issue",
          point: { x: 0, y: 0 },
          title: "Test",
          assigneeId: "outsider",
        },
      }),
    ).toThrow(/approved member/);
  });
  it("preserves private visibility when archiving", () => {
    const archived = archiveEntity(create(), worker, 1, now);
    expect(archived).toMatchObject({
      visibility: "archived",
      archivedFrom: "private",
      revision: 2,
    });
    expect(canReadEntity(archived, manager)).toBe(false);
    const published = archiveEntity(
      create({ visibility: "published" }, manager),
      manager,
      1,
      now,
    );
    expect(canReadEntity(published, other)).toBe(true);
  });
  it("appends comments without overwriting geometry and enforces revision/privacy", () => {
    const original = issue();
    const next = addEntityComment(original, other, 1, "Reply", id, now);
    expect(next.data).toEqual(original.data);
    expect(next.comments).toEqual([
      {
        id,
        authorId: "other",
        authorName: "Worker",
        body: "Reply",
        createdAt: now,
      },
    ]);
    expect(original.comments).toEqual([]);
    expect(() => addEntityComment(next, worker, 1, "stale", id, now)).toThrow(
      /Someone changed/,
    );
    expect(() =>
      addEntityComment(create(), other, 1, "private", id, now),
    ).toThrow();
  });
  it("prevents edits/comments after archive and bounds comments", () => {
    const original = archiveEntity(create(), worker, 1, now);
    expect(() =>
      prepareEntity(
        input({ expectedRevision: 2 }),
        original,
        worker,
        sheets,
        [],
        now,
      ),
    ).toThrow(/Archived/);
    expect(() =>
      addEntityComment(original, worker, 2, "comment", id, now),
    ).toThrow(/Archived/);
    const full: DrawingEntity = {
      ...create(),
      comments: Array.from({ length: 200 }, () => ({
        id,
        authorId: worker.id,
        authorName: worker.name,
        body: "x",
        createdAt: now,
      })),
    };
    expect(() =>
      addEntityComment(full, worker, 1, "one too many", id, now),
    ).toThrow(/comment limit/);
  });
  it.each(["version", "review", "transmittal"] as const)(
    "keeps %s snapshots immutable",
    (kind) => {
      const data =
        kind === "version"
          ? { sourceSheetId: source2, label: "Rev2" }
          : kind === "review"
            ? { sourceSheetId: sheetId, status: "approved" }
            : {
                title: "Issued",
                recipient: "Site team",
                sourceSheetIds: [sheetId, source2],
              };
      const original = create(
        { kind, visibility: "published", expectedMetadataRevision: 0, data },
        manager,
      );
      expect(original.snapshots?.length).toBe(kind === "transmittal" ? 2 : 1);
      expect(() =>
        prepareEntity(
          input({
            kind,
            visibility: "published",
            expectedRevision: 1,
            expectedMetadataRevision: 0,
            data,
          }),
          original,
          manager,
          sheets,
          [],
          now,
        ),
      ).toThrow(/immutable/);
      expect(() => archiveEntity(original, manager, 1, now)).toThrow(
        /immutable/,
      );
    },
  );
  it("does not mutate original metadata defaults or imply an approved revision", () => {
    expect(defaultDrawingMetadata(sheetId)).toMatchObject({
      revision: 0,
      currentSourceSheetId: sheetId,
      scale: null,
      status: "draft",
    });
  });
});

describe("bounded drawing tool payloads", () => {
  it.each([NaN, Infinity, -0.1, 1.1])("rejects unsafe coordinates %s", (x) => {
    expect(
      drawingMarkupSchema.safeParse({ ...markup, points: [{ x, y: 0 }] })
        .success,
    ).toBe(false);
  });
  it("rejects huge point/text payloads and unsafe colors", () => {
    expect(
      drawingMarkupSchema.safeParse({
        ...markup,
        points: Array.from({ length: 4001 }, () => ({ x: 0, y: 0 })),
      }).success,
    ).toBe(false);
    expect(
      drawingMarkupSchema.safeParse({ ...markup, text: "a".repeat(4001) })
        .success,
    ).toBe(false);
    expect(
      drawingMarkupSchema.safeParse({
        ...markup,
        stroke: "url(https://tracker/)",
      }).success,
    ).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.com",
    "https://user:password@example.com",
    "/api/job-rooms/files/../secret",
    "/api/job-rooms/files/%2e%2e/secret",
  ])("rejects unsafe hyperlink %s", (url) =>
    expect(drawingLinkSchema.safeParse(url).success).toBe(false),
  );
  it("accepts HTTPS links and bounded job attachment endpoints", () => {
    expect(drawingLinkSchema.parse("https://example.com/manual.pdf")).toBe(
      "https://example.com/manual.pdf",
    );
    expect(
      drawingLinkSchema.parse(`/api/drawings/attachments/${sheetId}/${id}`),
    ).toContain(id);
  });
  it("strips spoofed author/revision fields from clients", () => {
    const parsed = input({ authorId: "manager", revision: 999 });
    expect(parsed).not.toHaveProperty("authorId");
    expect(create({ authorId: "manager", revision: 999 }).authorId).toBe(
      "worker",
    );
  });
  it("requires expected metadata revision for version/review state transitions", () => {
    expect(
      drawingSaveSchema.safeParse({
        sheetId,
        id,
        expectedRevision: 0,
        kind: "version",
        visibility: "published",
        data: { sourceSheetId: source2, label: "Rev2" },
      }).success,
    ).toBe(false);
  });
});
