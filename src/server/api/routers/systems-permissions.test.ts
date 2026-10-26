// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
const calls = vi.hoisted(() => ({
  assessment: vi.fn(async () => ({ canAssess: true })),
  ai: vi.fn(),
  context: vi.fn(),
}));
vi.mock("~/server/job-systems/service", () => ({
  getAssessment: calls.assessment,
  startAssessment: calls.assessment,
  ensureSpecifications: calls.assessment,
  getSpecificationContext: calls.context,
  retainManualEdits: vi.fn(),
  validateSpecEvidence: vi.fn(),
  validateSpecReferences: vi.fn(),
}));
vi.mock("~/server/job-systems/ai-settings", () => ({
  readAssessmentAi: calls.ai,
  storeAssessmentAi: calls.ai,
}));
vi.mock("~/server/job-systems/ai-evaluator", () => ({
  testAssessmentAi: calls.ai,
}));
import { pipeSpecsRouter } from "./pipeSpecs";
import { toStoredConfig } from "~/server/auth/permissions";
import { defaultPipeSpec } from "~/lib/pipe-spec";
const id = "00000000-0000-4000-8000-000000000001";
function setup(executive = false) {
  const db = { select: vi.fn(), transaction: vi.fn() };
  return {
    db,
    caller: pipeSpecsRouter.createCaller({
      db,
      headers: new Headers(),
      userId: "member",
      user: {
        id: "member",
        role: "user",
        organizationId: id,
        organizationAccessStatus: "approved",
        ...(executive
          ? { stripeSubscriptionId: "sub_test", subscriptionStatus: "active" }
          : {}),
        permissionConfig: toStoredConfig({
          "lists.edit": true,
          "parts.edit": true,
          "org.settings": true,
          "drawings.view": true,
          "drawings.sheetTools": true,
        }),
      },
    } as never),
  };
}
it("blocks every Systems endpoint before reading data or starting an assessment for a non-executive", async () => {
  vi.clearAllMocks();
  const { caller, db } = setup();
  for (const run of [
    () => caller.list({ jobId: id }),
    () => caller.list(),
    () => caller.assessment({ jobId: id }),
    () => caller.assess({ jobId: id }),
    () => caller.assessSpecMaterials({ jobId: id }),
    () => caller.ensureSpecifications({ jobId: id }),
    () =>
      caller.save({
        jobId: id,
        system: "ST",
        revision: 0,
        spec: defaultPipeSpec(),
      }),
    () => caller.remove({ jobId: id, system: "ST" }),
    () => caller.aiConnection(),
    () => caller.saveAiConnection({ mode: "hosted" }),
  ])
    await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(db.select).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
  expect(calls.assessment).not.toHaveBeenCalled();
  expect(calls.context).not.toHaveBeenCalled();
  expect(calls.ai).not.toHaveBeenCalled();
});
it("allows an Executive to use Systems", async () => {
  const { caller } = setup(true);
  await expect(caller.assessment({ jobId: id })).resolves.toEqual({
    canAssess: true,
  });
});
