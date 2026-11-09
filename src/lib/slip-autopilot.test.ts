import { describe, expect, it } from "vitest";
import type { ReceiptOrderItem, SlipAnalysis } from "./packing-slip-review";
import { initialReview, type ReceivingLine } from "./receiving-review";
import {
  ASK_EVERY,
  CLEAN_RUN,
  autopilotBlockers,
  slipOutcome,
  supplierTrust,
  type ConfirmationEntry,
  type SlipOutcome,
} from "./slip-autopilot";

const person = (clean = true): SlipOutcome => ({
  by: "person",
  clean,
  undone: false,
});
const auto = (undone = false): SlipOutcome => ({
  by: "autopilot",
  clean: true,
  undone,
});
const times = (n: number, o: () => SlipOutcome) => Array.from({ length: n }, o);

describe("supplierTrust", () => {
  it("trusts a supplier after enough clean slips a person checked", () => {
    expect(supplierTrust(times(CLEAN_RUN - 1, person))).toMatchObject({
      trusted: false,
      checked: CLEAN_RUN - 1,
    });
    expect(supplierTrust(times(CLEAN_RUN, person))).toEqual({
      checked: CLEAN_RUN,
      trusted: true,
      due: false,
    });
  });
  it("starts again after a correction or an undo", () => {
    const run = times(CLEAN_RUN, person);
    expect(supplierTrust([person(false), ...run]).trusted).toBe(false);
    expect(supplierTrust([auto(true), ...run]).trusted).toBe(false);
    expect(
      supplierTrust([...times(CLEAN_RUN, person), person(false), ...run]),
    ).toMatchObject({ trusted: true, checked: CLEAN_RUN });
  });
  it("never counts its own receipts towards trust", () => {
    expect(
      supplierTrust([...times(4, auto), ...times(CLEAN_RUN - 1, person)])
        .trusted,
    ).toBe(false);
  });
  it("asks a person for every tenth slip", () => {
    const run = times(CLEAN_RUN, person);
    const after = (n: number) => supplierTrust([...times(n, auto), ...run]);
    expect(after(ASK_EVERY - 2)).toMatchObject({ trusted: true, due: false });
    expect(after(ASK_EVERY - 1)).toMatchObject({ trusted: false, due: true });
    // Once a person checks it, the count starts again.
    expect(
      supplierTrust([person(), ...times(ASK_EVERY - 1, auto), ...run]),
    ).toMatchObject({ trusted: true, due: false });
  });
});

const line = (id: string, item: string, quantity: number): ReceivingLine => ({
  id,
  page: 1,
  sourceIndex: Number(id),
  evidence: `${quantity} EA part ${item}`,
  description: `Part ${item}`,
  sku: "",
  unit: "ea",
  quantity,
  ordered: null,
  unitPrice: null,
  orderItemId: item,
  issues: [],
  checked: false,
});
const approved = (
  l: ReceivingLine,
  quantity = l.quantity!,
  itemId = l.orderItemId!,
) => ({
  ...l,
  quantity,
  orderItemId: itemId,
  checked: true,
  approved: { itemId, quantity, kind: "delivery" as const, by: "u", at: "t" },
});
const drafted = [line("0", "a", 6), line("1", "b", 2)];

describe("slipOutcome", () => {
  const confirm = (
    operation: string,
    after: ReceivingLine[],
    before = drafted,
    initiator = "human",
  ): ConfirmationEntry => ({
    operation,
    initiator,
    before: { kind: "delivery", lines: before },
    after: { kind: "delivery", lines: after },
  });
  it("is clean when the slip was received as it was drafted", () => {
    const received = drafted.map((l) => approved(l));
    expect(
      slipOutcome([confirm("link", drafted), confirm("approve", received)]),
    ).toEqual({ by: "person", clean: true, undone: false });
    expect(
      slipOutcome([confirm("approve", received, drafted, "autopilot")]),
    ).toEqual({ by: "autopilot", clean: true, undone: false });
  });
  it("waits until the slip is received", () => {
    expect(slipOutcome([confirm("link", drafted)])).toBeNull();
  });
  it("is not clean when a person changed what was read", () => {
    const [a, b] = drafted as [ReceivingLine, ReceivingLine];
    const dirty = (entries: ConfirmationEntry[]) => slipOutcome(entries)?.clean;
    expect(dirty([confirm("approve", [approved(a, 5), approved(b)])])).toBe(
      false,
    );
    expect(
      dirty([confirm("approve", [approved(a), approved(b, 2, "c")])]),
    ).toBe(false);
    expect(dirty([confirm("approve", [approved(a)])])).toBe(false);
    expect(
      dirty([
        confirm("addLine", [...drafted, line("2", "c", 1)]),
        confirm("approve", [
          approved(a),
          approved(b),
          approved(line("2", "c", 1)),
        ]),
      ]),
    ).toBe(false);
    expect(
      dirty([
        confirm("approve", [approved(a)]),
        confirm("approve", [approved(a), approved(b)]),
      ]),
    ).toBe(false);
    expect(
      dirty([
        confirm("approve", [
          approved(a),
          { ...approved(b), ignored: { reason: "x", by: "u", at: "t" } },
        ]),
      ]),
    ).toBe(false);
    expect(
      dirty([
        {
          ...confirm(
            "approve",
            drafted.map((l) => approved(l)),
          ),
          after: {
            kind: "return-credit",
            lines: drafted.map((l) => approved(l)),
          },
        },
      ]),
    ).toBe(false);
  });
  it("counts an undone automatic receipt", () => {
    const received = drafted.map((l) => approved(l));
    expect(
      slipOutcome([
        confirm("approve", received, drafted, "autopilot"),
        confirm("undoAutopilot", drafted, received),
        confirm("approve", received, drafted),
      ]),
    ).toEqual({ by: "person", clean: false, undone: true });
  });
});

describe("autopilotBlockers", () => {
  const items: ReceiptOrderItem[] = ["a", "b"].map((id) => ({
    id,
    description: `Part ${id}`,
    sku: null,
    aliases: [],
    ordered: 10,
    received: 0,
    verificationStatus: "pending",
    unit: "ea",
    piecesPerPack: null,
    individualUnit: null,
  }));
  function fixture() {
    const analysis: SlipAnalysis = {
      runId: "run",
      versionId: "v",
      status: "ready",
      startedAt: "now",
      items,
      warnings: [],
      totalsAgree: true,
      cascade: {
        policy: "p",
        status: "not-needed",
        reasons: [],
        lineIndexes: [],
      },
      lines: [
        ["a", 6],
        ["b", 2],
      ].map(([id, shipped]) => ({
        page: 1,
        evidence: `${shipped} EA Part ${id}`,
        orderItemId: id as string,
        shipped: shipped as number,
        backordered: null,
        unit: "ea",
        proposed: shipped as number,
        issues: [],
        readings: [
          {
            reader: "jev" as const,
            shipped: shipped as number,
            unit: "ea",
            orderItemId: id as string,
            match: 0.97,
            quantity: 0.97,
          },
        ],
      })),
    };
    const review = initialReview(analysis, "v", "u");
    const input = {
      review,
      analysis,
      currentVersionId: "v",
      items,
      orderId: "order",
      best: { orderId: "order", confidence: 95 },
    };
    return { ...input, blockers: () => autopilotBlockers(input) };
  }
  it("allows a slip read surely that matches its order", () => {
    expect(fixture().blockers()).toEqual([]);
  });
  it("blocks a slip whose printed totals were not checked", () => {
    const f = fixture();
    delete f.analysis.totalsAgree;
    expect(f.blockers()).toContain("printed totals not read or disagree");
  });
  it("blocks an escalated reading or a warning", () => {
    const f = fixture();
    f.analysis.cascade!.status = "completed";
    f.review.warnings.push("Page 2 of 3 is missing.");
    expect(f.blockers()).toEqual(
      expect.arrayContaining(["reading was escalated", "warnings"]),
    );
  });
  it("blocks an order match that is not the best or not sure", () => {
    const f = fixture();
    f.best.confidence = 89;
    expect(f.blockers()).toEqual(["order match unsure"]);
    f.best.confidence = 99;
    f.best.orderId = "other";
    expect(f.blockers()).toEqual(["order match unsure"]);
  });
  it("blocks a slip a person has started on", () => {
    const f = fixture();
    f.review.humanReviewed = true;
    expect(f.blockers()).toEqual(["already handled"]);
  });
  it("blocks returns and slips not yet confirmed as deliveries", () => {
    const f = fixture();
    f.review.kindConfirmed = false;
    expect(f.blockers()).toEqual(["not a delivery"]);
  });
  it("blocks any line that is flagged, unmatched or read twice", () => {
    const f = fixture();
    f.review.lines[0]!.issues.push("Check shipped quantity against the slip.");
    expect(f.blockers()).toEqual(["line 0 unsure"]);
    f.review.lines[0]!.issues = [];
    f.review.lines[1]!.orderItemId = "a";
    expect(f.blockers()).toEqual(["line 1 unsure"]);
    f.review.lines[1]!.orderItemId = null;
    expect(f.blockers()).toEqual(["line 1 unsure"]);
  });
  it("blocks a line whose reading is not sure", () => {
    const f = fixture();
    f.analysis.lines[1]!.readings![0]!.quantity = 0.8;
    expect(f.blockers()).toEqual(["line 1 unsure"]);
  });
  it("blocks a slip with no lines", () => {
    const f = fixture();
    f.review.lines = [];
    expect(f.blockers()).toEqual(["no lines"]);
  });
});
