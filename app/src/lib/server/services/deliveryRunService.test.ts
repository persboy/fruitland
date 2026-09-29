import { beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import type { AuthContext } from "../auth/guard";

const m = vi.hoisted(() => ({
  runFindOne: vi.fn(),
  runFindById: vi.fn(),
  runUpdateOne: vi.fn(),
  runCreate: vi.fn(),
  orderUpdateOne: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderCount: vi.fn(),
  userFindOne: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("../models/DeliveryRun", () => ({
  DeliveryRun: {
    findOne: (...a: unknown[]) => ({ lean: () => m.runFindOne(...a) }),
    findById: (...a: unknown[]) => ({ lean: () => m.runFindById(...a) }),
    updateOne: m.runUpdateOne,
    create: m.runCreate,
  },
}));
vi.mock("../models/Order", () => ({
  Order: { updateOne: m.orderUpdateOne, updateMany: m.orderUpdateMany, countDocuments: m.orderCount },
}));
vi.mock("../models/User", () => ({ User: { findOne: m.userFindOne } }));
vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();
  return { ...actual, startSession: m.startSession };
});

import {
  activateRun,
  addStopToDraft,
  cancelRun,
  confirmPickup,
  createDraftRun,
  getRun,
  proposeStopOutcome,
  removeStopFromDraft,
  reorderDraftStops,
  reorderStops,
  skipStop,
} from "./deliveryRunService";

const id = () => new Types.ObjectId();
const courierId = id();
const otherCourierId = id();
const adminId = id();

const admin: AuthContext = { userId: adminId.toString(), role: "admin" };
const courier: AuthContext = { userId: courierId.toString(), role: "courier" };
const customer: AuthContext = { userId: id().toString(), role: "customer" };

function makeRun(stops: Array<{ seq: number; status?: string }>, status = "active") {
  const runId = id();
  return {
    _id: runId,
    courierId,
    status,
    stops: stops.map((s) => ({ _id: id(), orderId: id(), sequence: s.seq, status: s.status ?? "pending" })),
  };
}

/** A session whose withTransaction just calls the callback (no real transactional semantics — that needs a real MongoDB replica set, see the integration test). */
function fakeSession() {
  return { withTransaction: async (fn: () => Promise<void>) => fn(), endSession: vi.fn() };
}

async function expectAppError(promise: Promise<unknown>, code: string, status?: number) {
  await expect(promise).rejects.toMatchObject({ name: "AppError", code, ...(status ? { status } : {}) });
}

function noDbTouched() {
  for (const fn of Object.values(m)) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("authorization boundaries (role checked before any database access)", () => {
  it("customers and couriers cannot create, activate, edit or cancel runs", async () => {
    for (const actor of [customer, courier]) {
      await expectAppError(createDraftRun(actor, { courierId: courierId.toString(), orderIds: [id().toString()] }), "FORBIDDEN_ROLE", 403);
      await expectAppError(activateRun(actor, id().toString()), "FORBIDDEN_ROLE", 403);
      await expectAppError(cancelRun(actor, id().toString()), "FORBIDDEN_ROLE", 403);
      await expectAppError(addStopToDraft(actor, id().toString(), id().toString()), "FORBIDDEN_ROLE", 403);
      await expectAppError(removeStopFromDraft(actor, id().toString(), id().toString()), "FORBIDDEN_ROLE", 403);
      await expectAppError(reorderDraftStops(actor, id().toString(), []), "FORBIDDEN_ROLE", 403);
    }
    noDbTouched();
  });

  it("an admin cannot act as the courier (reorder, pickup, outcome, skip)", async () => {
    await expectAppError(reorderStops(admin, id().toString(), []), "FORBIDDEN_ROLE", 403);
    await expectAppError(confirmPickup(admin, id().toString()), "FORBIDDEN_ROLE", 403);
    await expectAppError(proposeStopOutcome(admin, id().toString(), id().toString(), "delivered"), "FORBIDDEN_ROLE", 403);
    await expectAppError(skipStop(admin, id().toString(), id().toString()), "FORBIDDEN_ROLE", 403);
    noDbTouched();
  });

  it("customers cannot read a run", async () => {
    await expectAppError(getRun(customer, id().toString()), "FORBIDDEN_ROLE", 403);
  });
});

describe("courier ownership", () => {
  it("looks a run up by id AND the acting courier, and answers 404 (not 403) for someone else's run", async () => {
    m.runFindOne.mockResolvedValue(null);
    const otherCourier: AuthContext = { userId: otherCourierId.toString(), role: "courier" };
    const runId = id();
    await expectAppError(reorderStops(otherCourier, runId.toString(), []), "DELIVERY_RUN_NOT_FOUND", 404);
    const query = m.runFindOne.mock.calls[0]![0] as { _id: Types.ObjectId; courierId: Types.ObjectId };
    expect(query._id.equals(runId)).toBe(true);
    expect(query.courierId.equals(otherCourierId)).toBe(true);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it("a malformed run id is a 404, not a crash", async () => {
    await expectAppError(reorderStops(courier, "not-an-id", []), "DELIVERY_RUN_NOT_FOUND", 404);
  });
});

describe("createDraftRun — planning only, reserves nothing", () => {
  const orderA = id();
  const orderB = id();

  function arrange() {
    m.userFindOne.mockResolvedValue({ courierProfile: { vehicleType: "motorcycle" } });
    m.orderCount.mockResolvedValue(2);
  }

  it("rejects the same order twice before touching the database", async () => {
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString(), orderA.toString()] }), "DUPLICATE_ORDER", 400);
    noDbTouched();
  });

  it("only accepts an active courier", async () => {
    m.userFindOne.mockResolvedValue(null);
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString()] }), "COURIER_NOT_FOUND", 400);
    expect(m.userFindOne.mock.calls[0]![0]).toMatchObject({ role: "courier", isActive: true });
    expect(m.runCreate).not.toHaveBeenCalled();
  });

  it("creates the run WITHOUT writing to any Order — no courierId, no assignedAt, nothing reserved", async () => {
    arrange();
    const runId = id();
    m.runCreate.mockResolvedValue({ _id: runId });
    m.runFindById.mockResolvedValue({
      _id: runId,
      courierId,
      status: "draft",
      stops: [
        { _id: id(), orderId: orderA, sequence: 1, status: "pending" },
        { _id: id(), orderId: orderB, sequence: 2, status: "pending" },
      ],
    });
    const dto = await createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString(), orderB.toString()] });

    expect(m.orderUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
    expect(m.runCreate.mock.calls[0]![0]).toMatchObject({ status: "draft" });
    expect(dto.status).toBe("draft");
    expect(dto.stops.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("does NOT reject a duplicate-key error specially (the index no longer covers drafts) — any create failure just propagates", async () => {
    m.userFindOne.mockResolvedValue({ courierProfile: { vehicleType: "motorcycle" } });
    m.orderCount.mockResolvedValue(1);
    m.runCreate.mockRejectedValue(Object.assign(new Error("boom"), { code: 11000 }));
    await expect(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString()] })).rejects.toThrow("boom");
  });

  it("fails when an order does not exist, before creating anything", async () => {
    m.userFindOne.mockResolvedValue({ courierProfile: { vehicleType: "car" } });
    m.orderCount.mockResolvedValue(1);
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString(), orderB.toString()] }), "ORDER_NOT_FOUND", 404);
    expect(m.runCreate).not.toHaveBeenCalled();
  });
});

describe("draft editing — admin only, draft only, never touches Order.delivery", () => {
  function draftWith(stops: Array<{ orderId: Types.ObjectId; seq: number }>) {
    return { _id: id(), courierId, status: "draft", stops: stops.map((s) => ({ _id: id(), orderId: s.orderId, sequence: s.seq, status: "pending" })) };
  }

  it("addStopToDraft appends the next sequence and writes only the run, never an Order", async () => {
    const run = draftWith([{ orderId: id(), seq: 1 }, { orderId: id(), seq: 2 }]);
    m.runFindById.mockResolvedValue(run);
    m.orderCount.mockResolvedValue(1);
    m.runUpdateOne.mockResolvedValue({ matchedCount: 1 });
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run });
    const newOrder = id();
    await addStopToDraft(admin, run._id.toString(), newOrder.toString());
    const [filter, update] = m.runUpdateOne.mock.calls[0]!;
    expect(filter).toMatchObject({ status: "draft" });
    expect(update.$set.stops).toHaveLength(3);
    expect(update.$set.stops[2]).toMatchObject({ sequence: 3, status: "pending" });
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("addStopToDraft rejects an order already in the SAME draft", async () => {
    const existingOrder = id();
    const run = draftWith([{ orderId: existingOrder, seq: 1 }]);
    m.runFindById.mockResolvedValue(run);
    await expectAppError(addStopToDraft(admin, run._id.toString(), existingOrder.toString()), "DUPLICATE_ORDER", 400);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it("addStopToDraft refuses on a run that is not a draft", async () => {
    const run = { ...draftWith([{ orderId: id(), seq: 1 }]), status: "active" };
    m.runFindById.mockResolvedValue(run);
    await expectAppError(addStopToDraft(admin, run._id.toString(), id().toString()), "DELIVERY_RUN_NOT_DRAFT", 409);
  });

  it("removeStopFromDraft re-sequences the remaining stops to a contiguous 1..n and touches no Order", async () => {
    const [oA, oB, oC] = [id(), id(), id()];
    const run = draftWith([{ orderId: oA, seq: 1 }, { orderId: oB, seq: 2 }, { orderId: oC, seq: 3 }]);
    m.runUpdateOne.mockResolvedValue({ matchedCount: 1 });
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce(run);
    await removeStopFromDraft(admin, run._id.toString(), run.stops[1]!._id.toString());
    const update = m.runUpdateOne.mock.calls[0]![1];
    expect(update.$set.stops.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2]);
    expect(update.$set.stops.map((s: { orderId: Types.ObjectId }) => s.orderId)).toEqual([oA, oC]);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it("removeStopFromDraft refuses to leave a run with zero stops", async () => {
    const run = draftWith([{ orderId: id(), seq: 1 }]);
    m.runFindById.mockResolvedValue(run);
    await expectAppError(removeStopFromDraft(admin, run._id.toString(), run.stops[0]!._id.toString()), "DELIVERY_RUN_WOULD_BE_EMPTY", 400);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it("reorderDraftStops permutes freely since every draft stop is pending", async () => {
    const [oA, oB] = [id(), id()];
    const run = draftWith([{ orderId: oA, seq: 1 }, { orderId: oB, seq: 2 }]);
    m.runUpdateOne.mockResolvedValue({ matchedCount: 1 });
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce(run);
    await reorderDraftStops(admin, run._id.toString(), [run.stops[1]!._id.toString(), run.stops[0]!._id.toString()]);
    const update = m.runUpdateOne.mock.calls[0]![1];
    expect(update.$set.stops.map((s: { orderId: Types.ObjectId; sequence: number }) => [s.orderId, s.sequence])).toEqual([
      [oA, 2],
      [oB, 1],
    ]);
  });
});

describe("activateRun — the one transactional, all-or-nothing operation", () => {
  function arrangeDraft(stops: Array<{ orderId: Types.ObjectId }>) {
    const run = { _id: id(), courierId, status: "draft", stops: stops.map((s) => ({ _id: id(), orderId: s.orderId, sequence: 1, status: "pending" })) };
    m.runFindById.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    return run;
  }

  it("distinguishes a missing run from one that is not a draft, without starting a session", async () => {
    m.runFindById.mockResolvedValueOnce(null);
    await expectAppError(activateRun(admin, id().toString()), "DELIVERY_RUN_NOT_FOUND", 404);
    m.runFindById.mockResolvedValueOnce({ _id: id(), status: "active", stops: [] });
    await expectAppError(activateRun(admin, id().toString()), "INVALID_RUN_TRANSITION", 409);
    expect(m.startSession).not.toHaveBeenCalled();
  });

  it("assigns every order inside the transaction with assignedAt = now (not draft creation time), then flips the run", async () => {
    const [oA, oB] = [id(), id()];
    const run = arrangeDraft([{ orderId: oA }, { orderId: oB }]);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "active" });

    await activateRun(admin, run._id.toString());

    expect(m.orderUpdateOne).toHaveBeenCalledTimes(2);
    for (const call of m.orderUpdateOne.mock.calls) {
      expect(call[0]).toMatchObject({ status: "preparing", "delivery.status": "unassigned" });
      expect(call[1].$set["delivery.courierId"]).toEqual(courierId);
      expect(call[1].$set["delivery.assignedAt"]).toBeInstanceOf(Date);
      expect(call[2]).toHaveProperty("session");
    }
    const [flipFilter, flipUpdate, flipOptions] = m.runUpdateOne.mock.calls[0]!;
    expect(flipFilter).toMatchObject({ status: "draft" });
    expect(flipUpdate.$set.status).toBe("active");
    expect(flipOptions).toHaveProperty("session");
  });

  it("aborts entirely — no run flip — when any order is no longer eligible (all-or-nothing)", async () => {
    const [oA, oB, oC] = [id(), id(), id()];
    arrangeDraft([{ orderId: oA }, { orderId: oB }, { orderId: oC }]);
    m.orderUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 }).mockResolvedValueOnce({ modifiedCount: 0 });

    await expectAppError(
      activateRun(admin, id().toString()),
      "ORDER_NOT_ASSIGNABLE",
      409,
    );
    // Only the two orders up to (and including) the failing one were attempted; the run was never flipped.
    expect(m.orderUpdateOne).toHaveBeenCalledTimes(2);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it("reports a conflict, not a crash, when the run changed between the pre-check and the transaction", async () => {
    arrangeDraft([{ orderId: id() }]);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(activateRun(admin, id().toString()), "DELIVERY_RUN_CHANGED", 409);
  });

  it("reports a conflict when the run-level unique index rejects the flip (order already in another active run)", async () => {
    arrangeDraft([{ orderId: id() }]);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runUpdateOne.mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 }));
    await expectAppError(activateRun(admin, id().toString()), "ORDER_ALREADY_IN_ACTIVE_RUN", 409);
  });

  it("reports the environment limitation — not a silent non-transactional fallback — when the deployment cannot run transactions", async () => {
    arrangeDraft([{ orderId: id() }]);
    const err = Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
    m.startSession.mockResolvedValue({ withTransaction: async () => { throw err; }, endSession: vi.fn() });
    await expect(activateRun(admin, id().toString())).rejects.toMatchObject({ name: "Error", message: expect.stringContaining("replica set") });
    // Critically: not an AppError (this is an unexpected/environment failure, not an ordinary domain rejection),
    // and the order was never touched non-transactionally as a fallback.
    await expect(activateRun(admin, id().toString())).rejects.not.toMatchObject({ name: "AppError" });
  });

  it("always ends the session, even on failure", async () => {
    const run = arrangeDraft([{ orderId: id() }]);
    const session = fakeSession();
    m.startSession.mockResolvedValue(session);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(activateRun(admin, run._id.toString()), "ORDER_NOT_ASSIGNABLE", 409);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("cancelRun", () => {
  it("cancelling a DRAFT never touches any Order — nothing was ever reserved", async () => {
    const run = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] };
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "cancelled" });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await cancelRun(admin, run._id.toString());
    expect(m.runUpdateOne.mock.calls[0]![0]).toMatchObject({ status: "draft" });
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
    expect(m.orderCount).not.toHaveBeenCalled();
  });

  it("cancelling an ACTIVE run refuses once any order has been picked up, and releases nothing", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], "active");
    m.runFindById.mockResolvedValue(run);
    m.orderCount.mockResolvedValue(1);
    await expectAppError(cancelRun(admin, run._id.toString()), "RUN_HAS_PICKED_UP_ORDERS", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("cancelling an ACTIVE run releases assignments that were never picked up", async () => {
    const run = makeRun([{ seq: 1 }], "active");
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "cancelled" });
    m.orderCount.mockResolvedValue(0);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await cancelRun(admin, run._id.toString());
    expect(m.orderUpdateMany.mock.calls[0]![0]).toMatchObject({ "delivery.status": "assigned" });
  });

  it("cannot cancel a completed run", async () => {
    const run = makeRun([{ seq: 1, status: "delivered" }], "completed");
    m.runFindById.mockResolvedValue(run);
    await expectAppError(cancelRun(admin, run._id.toString()), "INVALID_RUN_TRANSITION", 409);
  });
});

describe("confirmPickup — Decision 2: an explicit, courier-only, physical-custody event distinct from assignment", () => {
  it("moves every pending stop's order from assigned to picked_up, sets pickedUpAt, and is scoped to this courier's own assignment", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }, { seq: 3, status: "delivered" }]);
    m.runFindOne.mockResolvedValue(run);
    m.orderUpdateMany.mockResolvedValue({ modifiedCount: 2 });

    const before = Date.now();
    const result = await confirmPickup(courier, run._id.toString());
    expect(result.pickedUpCount).toBe(2);

    const [filter, update] = m.orderUpdateMany.mock.calls[0]!;
    // Only the two still-pending stops' orders — not the already-delivered one.
    expect(filter._id.$in).toHaveLength(2);
    expect(filter["delivery.status"]).toBe("assigned");
    expect(filter["delivery.courierId"].equals(courierId)).toBe(true);
    expect(update.$set["delivery.status"]).toBe("picked_up");
    expect(update.$set["delivery.pickedUpAt"]).toBeInstanceOf(Date);
    expect((update.$set["delivery.pickedUpAt"] as Date).getTime()).toBeGreaterThanOrEqual(before);
    // assignedAt is never part of this write — Decision 1's assignment timestamp is untouched by pickup.
    expect(update.$set).not.toHaveProperty("delivery.assignedAt");
    expect(Object.keys(update.$set)).not.toContain("delivery.assignedAt");
  });

  it("a courier cannot confirm pickup on another courier's run (looked up by id AND the acting courier)", async () => {
    m.runFindOne.mockResolvedValue(null);
    const otherCourier: AuthContext = { userId: otherCourierId.toString(), role: "courier" };
    const runId = id();
    await expectAppError(confirmPickup(otherCourier, runId.toString()), "DELIVERY_RUN_NOT_FOUND", 404);
    const query = m.runFindOne.mock.calls[0]![0] as { _id: Types.ObjectId; courierId: Types.ObjectId };
    expect(query._id.equals(runId)).toBe(true);
    expect(query.courierId.equals(otherCourierId)).toBe(true);
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it.each(["draft", "completed", "cancelled"])("refuses pickup on a %s (non-active) run", async (status) => {
    const run = makeRun([{ seq: 1 }], status);
    m.runFindOne.mockResolvedValue(run);
    await expectAppError(confirmPickup(courier, run._id.toString()), "DELIVERY_RUN_NOT_ACTIVE", 409);
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("admin cannot perform the courier's pickup transition", async () => {
    await expectAppError(confirmPickup(admin, id().toString()), "FORBIDDEN_ROLE", 403);
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });
});

describe("reorderStops (courier, active run)", () => {
  it("writes the new sequences in one atomic update guarded by active status, owner and 'still pending'", async () => {
    const run = makeRun([{ seq: 1, status: "delivered" }, { seq: 2 }, { seq: 3 }, { seq: 4 }]);
    m.runFindOne.mockResolvedValue(run);
    m.runUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    m.runFindById.mockResolvedValue(run);
    const [, s2, s3, s4] = run.stops;

    await reorderStops(courier, run._id.toString(), [s4!._id.toString(), s2!._id.toString(), s3!._id.toString()]);

    const [filter, update, options] = m.runUpdateOne.mock.calls[0]!;
    expect(filter).toMatchObject({ status: "active" });
    expect(filter.courierId.equals(courierId)).toBe(true);
    expect(filter.$and).toHaveLength(3);
    expect(update.$set).toEqual({ "stops.$[s0].sequence": 2, "stops.$[s1].sequence": 3, "stops.$[s2].sequence": 4 });
    expect(options.arrayFilters).toHaveLength(3);
  });

  it("refuses to touch a delivered stop and never writes", async () => {
    const run = makeRun([{ seq: 1, status: "delivered" }, { seq: 2 }]);
    m.runFindOne.mockResolvedValue(run);
    await expectAppError(
      reorderStops(courier, run._id.toString(), run.stops.map((s) => s._id.toString())),
      "REORDER_NOT_PENDING",
      400,
    );
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it.each(["draft", "completed", "cancelled"])("refuses to reorder a %s run", async (status) => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], status);
    m.runFindOne.mockResolvedValue(run);
    await expectAppError(reorderStops(courier, run._id.toString(), run.stops.map((s) => s._id.toString())), "DELIVERY_RUN_NOT_ACTIVE", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });
});

describe("proposeStopOutcome — the courier proposes, never resolves", () => {
  function arrange(orderUpdate = { modifiedCount: 1 }) {
    const run = makeRun([{ seq: 1 }, { seq: 2 }]);
    m.runFindOne.mockResolvedValue(run);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
    m.orderUpdateOne.mockResolvedValue(orderUpdate);
    m.runFindById.mockResolvedValue(run);
    return run;
  }

  it.each([
    ["delivered", "delivered"],
    ["failed", "returned"],
  ] as const)("a %s stop puts the order into 'proposed' with outcome %s", async (outcome, proposedOutcome) => {
    const run = arrange();
    await proposeStopOutcome(courier, run._id.toString(), run.stops[0]!._id.toString(), outcome);

    const [filter, update] = m.orderUpdateOne.mock.calls[0]!;
    expect(filter["delivery.status"]).toBe("picked_up");
    expect(filter["delivery.courierId"].equals(courierId)).toBe(true);
    expect(update.$set["delivery.status"]).toBe("proposed");
    expect(update.$set["delivery.proposedOutcome"]).toBe(proposedOutcome);
    const everyOrderWrite = JSON.stringify([...m.orderUpdateOne.mock.calls, ...m.orderUpdateMany.mock.calls]);
    expect(everyOrderWrite).not.toContain("resolved");
    expect(everyOrderWrite).not.toContain('"status":"shipped"');
  });

  it("refuses a stop that already has an outcome", async () => {
    const run = makeRun([{ seq: 1, status: "delivered" }]);
    m.runFindOne.mockResolvedValue(run);
    await expectAppError(proposeStopOutcome(courier, run._id.toString(), run.stops[0]!._id.toString(), "failed"), "DELIVERY_STOP_ALREADY_RESOLVED", 409);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it("gives the stop back when the order was never picked up, so run and order cannot disagree", async () => {
    const run = arrange({ modifiedCount: 0 });
    await expectAppError(proposeStopOutcome(courier, run._id.toString(), run.stops[0]!._id.toString(), "delivered"), "ORDER_NOT_PICKED_UP", 409);
    const revert = m.runUpdateOne.mock.calls[1]!;
    expect(revert[1]).toMatchObject({ $set: { "stops.$.status": "pending" } });
  });

  it("completes the run only when no stop is left pending", async () => {
    const run = arrange();
    await proposeStopOutcome(courier, run._id.toString(), run.stops[0]!._id.toString(), "delivered");
    const completion = m.runUpdateOne.mock.calls[1]!;
    expect(completion[0]).toMatchObject({ status: "active", stops: { $not: { $elemMatch: { status: "pending" } } } });
    expect(completion[1].$set.status).toBe("completed");
  });

  it("returns 404 for a stop that is not in the run", async () => {
    const run = arrange();
    await expectAppError(proposeStopOutcome(courier, run._id.toString(), id().toString(), "delivered"), "DELIVERY_STOP_NOT_FOUND", 404);
  });
});
