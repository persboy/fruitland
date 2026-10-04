import { beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import type { AuthContext } from "../auth/guard";

const m = vi.hoisted(() => ({
  runFindOne: vi.fn(),
  runFindById: vi.fn(),
  runUpdateOne: vi.fn(),
  runCreate: vi.fn(),
  runExists: vi.fn(),
  orderUpdateOne: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderCount: vi.fn(),
  orderFindOne: vi.fn(),
  auditCreate: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
  userUpdateMany: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("../models/DeliveryRun", () => ({
  DeliveryRun: {
    findOne: (...a: unknown[]) => ({ lean: () => m.runFindOne(...a), session: () => ({ lean: () => m.runFindOne(...a) }) }),
    findById: (...a: unknown[]) => ({ lean: () => m.runFindById(...a) }),
    updateOne: m.runUpdateOne,
    create: m.runCreate,
    exists: (...a: unknown[]) => ({ session: () => m.runExists(...a) }),
  },
}));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));
vi.mock("../models/Order", () => ({
  Order: {
    updateOne: m.orderUpdateOne,
    updateMany: m.orderUpdateMany,
    countDocuments: m.orderCount,
    findOne: (...a: unknown[]) => ({ session: () => ({ lean: () => m.orderFindOne(...a) }) }),
  },
}));
vi.mock("../models/User", () => ({
  User: { findOne: m.userFindOne, updateOne: m.userUpdateOne, updateMany: m.userUpdateMany },
}));
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
    m.runExists.mockResolvedValue(null); // no other active run for this courier, by default
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

  describe("Decision 4 (approved): at most one active run per courier", () => {
    it("the pre-check queries for another ACTIVE run of this SAME courier, inside the transaction's session", async () => {
      const run = arrangeDraft([{ orderId: id() }]);
      m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      await activateRun(admin, run._id.toString());
      expect(m.runExists.mock.calls[0]![0]).toMatchObject({ courierId, status: "active" });
    });

    it("rejects activation when the courier already has another active run — no order is touched, no flip happens", async () => {
      const run = arrangeDraft([{ orderId: id() }, { orderId: id() }]);
      m.runExists.mockResolvedValue({ _id: id() });
      await expectAppError(activateRun(admin, run._id.toString()), "COURIER_ALREADY_HAS_ACTIVE_RUN", 409);
      expect(m.orderUpdateOne).not.toHaveBeenCalled();
      expect(m.runUpdateOne).not.toHaveBeenCalled();
    });

    it("maps a courierId-index duplicate-key error (the authoritative DB-level guard) to the same domain error as the pre-check", async () => {
      arrangeDraft([{ orderId: id() }]);
      m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.runUpdateOne.mockRejectedValue(Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { courierId: 1 } }));
      await expectAppError(activateRun(admin, id().toString()), "COURIER_ALREADY_HAS_ACTIVE_RUN", 409);
    });

    it("a stops.orderId-index duplicate-key error still maps to the order-level conflict, not the courier one", async () => {
      arrangeDraft([{ orderId: id() }]);
      m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.runUpdateOne.mockRejectedValue(Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { "stops.orderId": 1 } }));
      await expectAppError(activateRun(admin, id().toString()), "ORDER_ALREADY_IN_ACTIVE_RUN", 409);
    });

    it("does not mutate Order.status — Decision 3's invariant holds for the new pre-check path too", async () => {
      const run = arrangeDraft([{ orderId: id() }]);
      m.runExists.mockResolvedValue({ _id: id() });
      await expectAppError(activateRun(admin, run._id.toString()), "COURIER_ALREADY_HAS_ACTIVE_RUN", 409);
      expect(m.orderUpdateOne).not.toHaveBeenCalled();
      expect(m.orderUpdateMany).not.toHaveBeenCalled();
    });
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
  it("moves every pending stop's order from assigned to picked_up inside one transaction, sets pickedUpAt, and is scoped to this courier's own assignment", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }, { seq: 3, status: "delivered" }]);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });

    const before = Date.now();
    const result = await confirmPickup(courier, run._id.toString());
    expect(result.pickedUpCount).toBe(2);

    // One conditional write per pending stop (not the already-delivered one), each with the session.
    expect(m.orderUpdateOne).toHaveBeenCalledTimes(2);
    for (const [filter, update, options] of m.orderUpdateOne.mock.calls) {
      expect(filter["delivery.status"]).toBe("assigned");
      expect(filter["delivery.courierId"].equals(courierId)).toBe(true);
      expect(update.$set["delivery.status"]).toBe("picked_up");
      expect((update.$set["delivery.pickedUpAt"] as Date).getTime()).toBeGreaterThanOrEqual(before);
      expect(Object.keys(update.$set)).not.toContain("delivery.assignedAt");
      expect(options).toHaveProperty("session");
    }
  });

  it("Decision 7: if any pending stop's order is no longer assigned (and not already this courier's pickup) the whole operation fails", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }]);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 }).mockResolvedValueOnce({ modifiedCount: 0 });
    m.orderFindOne.mockResolvedValue({ delivery: { status: "unassigned" } });
    await expectAppError(confirmPickup(courier, run._id.toString()), "ORDER_NOT_ASSIGNED", 409);
    // (Rollback of the first stop's write is the real transaction's job — asserted in the integration test.)
  });

  it("a repeat call whose orders are already this courier's picked_up is an idempotent no-op (count 0)", async () => {
    const run = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    m.orderFindOne.mockResolvedValue({ delivery: { status: "picked_up", courierId } });
    expect((await confirmPickup(courier, run._id.toString())).pickedUpCount).toBe(0);
  });

  it("a courier cannot confirm pickup on another courier's run (looked up by id AND the acting courier)", async () => {
    m.runFindOne.mockResolvedValue(null);
    m.startSession.mockResolvedValue(fakeSession());
    const otherCourier: AuthContext = { userId: otherCourierId.toString(), role: "courier" };
    const runId = id();
    await expectAppError(confirmPickup(otherCourier, runId.toString()), "DELIVERY_RUN_NOT_FOUND", 404);
    const query = m.runFindOne.mock.calls[0]![0] as { _id: Types.ObjectId; courierId: Types.ObjectId };
    expect(query._id.equals(runId)).toBe(true);
    expect(query.courierId.equals(otherCourierId)).toBe(true);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it.each(["draft", "completed", "cancelled"])("refuses pickup on a %s (non-active) run", async (status) => {
    const run = makeRun([{ seq: 1 }], status);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    await expectAppError(confirmPickup(courier, run._id.toString()), "DELIVERY_RUN_NOT_ACTIVE", 409);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it("admin cannot perform the courier's pickup transition", async () => {
    await expectAppError(confirmPickup(admin, id().toString()), "FORBIDDEN_ROLE", 403);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
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

describe("Decision 3 (approved, Option F): DeliveryRun never mutates Order.status", () => {
  /**
   * `Order.status` ownership, its transitions (including "shipped"), and
   * the trigger/actor for each are explicitly deferred to the official
   * Orders phase — not decided here (Phase 14 Decision Review, Decision 3).
   * `delivery.assignedAt` being set remains a documented PREREQUISITE for a
   * future "shipped" transition, not a trigger this file is allowed to act
   * on. Every write DeliveryRun makes to an Order must therefore touch only
   * `delivery.*` — this one invariant is checked directly against every
   * $set/$unset object across every Order.updateOne/updateMany call any
   * DeliveryRun operation makes, rather than trusting each operation's own
   * narrower assertions not to regress.
   */
  function assertNoOrderStatusWrites() {
    const allCalls = [...m.orderUpdateOne.mock.calls, ...m.orderUpdateMany.mock.calls];
    expect(allCalls.length).toBeGreaterThan(0); // a vacuous pass (no Order write at all) would not exercise this invariant
    for (const call of allCalls) {
      const update = call[1] as { $set?: Record<string, unknown>; $unset?: Record<string, unknown> };
      for (const mutation of [update.$set, update.$unset]) {
        if (!mutation) continue;
        expect(Object.keys(mutation)).not.toContain("status");
        for (const key of Object.keys(mutation)) {
          expect(key === "status" || key.startsWith("delivery.")).toBe(true);
        }
      }
    }
  }

  it("activateRun writes only delivery.* fields to each Order", async () => {
    const run = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] };
    m.runFindById.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await activateRun(admin, run._id.toString());
    assertNoOrderStatusWrites();
  });

  it("confirmPickup writes only delivery.* fields to Order", async () => {
    const run = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await confirmPickup(courier, run._id.toString());
    assertNoOrderStatusWrites();
  });

  it("proposeStopOutcome (delivered and failed) writes only delivery.* fields to Order", async () => {
    for (const outcome of ["delivered", "failed"] as const) {
      m.orderUpdateOne.mockClear();
      m.orderUpdateMany.mockClear();
      const run = makeRun([{ seq: 1 }]);
      m.runFindOne.mockResolvedValue(run);
      m.runUpdateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
      m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.runFindById.mockResolvedValue(run);
      await proposeStopOutcome(courier, run._id.toString(), run.stops[0]!._id.toString(), outcome);
      assertNoOrderStatusWrites();
    }
  });

  it("createDraftRun, addStopToDraft, removeStopFromDraft, reorderDraftStops and cancelRun (draft or active) never write to Order at all", async () => {
    const scenarios: Array<() => Promise<unknown>> = [
      async () => {
        m.userFindOne.mockResolvedValue({ courierProfile: { vehicleType: "car" } });
        m.orderCount.mockResolvedValue(1);
        const runId = id();
        m.runCreate.mockResolvedValue({ _id: runId });
        m.runFindById.mockResolvedValue({ _id: runId, courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] });
        return createDraftRun(admin, { courierId: courierId.toString(), orderIds: [id().toString()] });
      },
      async () => {
        const draft = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] };
        m.runFindById.mockResolvedValue(draft);
        m.orderCount.mockResolvedValue(1);
        m.runUpdateOne.mockResolvedValue({ matchedCount: 1 });
        return addStopToDraft(admin, draft._id.toString(), id().toString());
      },
      async () => {
        const draft = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }, { _id: id(), orderId: id(), sequence: 2, status: "pending" }] };
        m.runFindById.mockResolvedValue(draft);
        m.runUpdateOne.mockResolvedValue({ matchedCount: 1 });
        return removeStopFromDraft(admin, draft._id.toString(), draft.stops[0]!._id.toString());
      },
      async () => {
        const draft = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }, { _id: id(), orderId: id(), sequence: 2, status: "pending" }] };
        m.runFindById.mockResolvedValue(draft);
        m.runUpdateOne.mockResolvedValue({ matchedCount: 1 });
        return reorderDraftStops(admin, draft._id.toString(), [draft.stops[1]!._id.toString(), draft.stops[0]!._id.toString()]);
      },
      async () => {
        const draft = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] };
        m.runFindById.mockResolvedValue(draft);
        m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
        return cancelRun(admin, draft._id.toString());
      },
      async () => {
        const run = makeRun([{ seq: 1 }], "active");
        m.runFindById.mockResolvedValue(run);
        m.orderCount.mockResolvedValue(0);
        m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
        return cancelRun(admin, run._id.toString());
      },
    ];
    for (const run of scenarios) {
      m.orderUpdateOne.mockClear();
      m.orderUpdateMany.mockClear();
      await run();
      expect(m.orderUpdateOne).not.toHaveBeenCalled();
      // cancelRun on an ACTIVE run does write to Order (releaseOrders) — but only delivery.* fields, never `status`.
      for (const call of m.orderUpdateMany.mock.calls) {
        const update = call[1] as { $set?: Record<string, unknown>; $unset?: Record<string, unknown> };
        for (const mutation of [update.$set, update.$unset]) {
          if (!mutation) continue;
          for (const key of Object.keys(mutation)) expect(key.startsWith("delivery.")).toBe(true);
        }
      }
    }
  });

  it("skipStop (Decision 7) writes only delivery.* fields to Order — never `status`", async () => {
    const run = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(run);
    m.runFindById.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runExists.mockResolvedValue(null);
    await skipStop(courier, run._id.toString(), run.stops[0]!._id.toString());
    assertNoOrderStatusWrites();
  });
});

describe("Decision 5 (approved): courier availability is deferred — courierProfile.status never gates or is mutated by DeliveryRun", () => {
  const courierWithStatus = (status: string) => ({ courierProfile: { vehicleType: "motorcycle", status } });

  it.each(["offline", "online", "busy"] as const)(
    "createDraftRun succeeds for a courier whose courierProfile.status is '%s'",
    async (status) => {
      m.userFindOne.mockResolvedValue(courierWithStatus(status));
      m.orderCount.mockResolvedValue(1);
      const runId = id();
      m.runCreate.mockResolvedValue({ _id: runId });
      const orderId = id();
      m.runFindById.mockResolvedValue({ _id: runId, courierId, status: "draft", stops: [{ _id: id(), orderId, sequence: 1, status: "pending" }] });

      const dto = await createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderId.toString()] });
      expect(dto.status).toBe("draft");
      // The eligibility filter is role + isActive only — status is not part of the query at all.
      expect(m.userFindOne.mock.calls[0]![0]).toMatchObject({ role: "courier", isActive: true });
      expect(m.userFindOne.mock.calls[0]![0]).not.toHaveProperty("courierProfile.status");
    },
  );

  it.each(["offline", "online", "busy"] as const)(
    "activateRun succeeds regardless of the courier's courierProfile.status ('%s') — offline does not block it, online/busy grant nothing special",
    async (status) => {
      // activateRun never loads the courier's User document at all (see below) —
      // 'status' here only documents which value this scenario represents.
      void status;
      const run = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] };
      m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "active" });
      m.startSession.mockResolvedValue(fakeSession());
      m.runExists.mockResolvedValue(null);
      m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });

      const active = await activateRun(admin, run._id.toString());
      expect(active.status).toBe("active");
      expect(m.userFindOne).not.toHaveBeenCalled();
    },
  );

  it("no DeliveryRun operation ever writes to the User collection (courierProfile.status is never mutated)", async () => {
    // A representative sweep across admin- and courier-facing operations, including
    // activation (the one place Decisions 1 and 4 write real state).
    const orderId = id();
    m.userFindOne.mockResolvedValue(courierWithStatus("offline"));
    m.orderCount.mockResolvedValue(1);
    const draftId = id();
    m.runCreate.mockResolvedValue({ _id: draftId });
    const draft = { _id: draftId, courierId, status: "draft", stops: [{ _id: id(), orderId, sequence: 1, status: "pending" }] };
    m.runFindById.mockResolvedValue(draft);
    await createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderId.toString()] });

    m.startSession.mockResolvedValue(fakeSession());
    m.runExists.mockResolvedValue(null);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await activateRun(admin, draftId.toString());

    const activeRun = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(activeRun);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await confirmPickup(courier, activeRun._id.toString());

    expect(m.userUpdateOne).not.toHaveBeenCalled();
    expect(m.userUpdateMany).not.toHaveBeenCalled();
  });

  it("User.isActive remains the only, separate account-level gate — an inactive account is still rejected regardless of courierProfile.status", async () => {
    m.userFindOne.mockResolvedValue(null); // simulates the {role:"courier", isActive:true} filter matching nothing
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [id().toString()] }), "COURIER_NOT_FOUND", 400);
    expect(m.runCreate).not.toHaveBeenCalled();
  });
});

describe("skipStop — Decision 7 (transactional release, audit, completion, hook, retry)", () => {
  const stopIdOf = (run: ReturnType<typeof makeRun>, i = 0) => run.stops[i]!._id.toString();

  function arrangeActive(run: ReturnType<typeof makeRun>, opts: { pendingLeft: boolean }) {
    m.runFindOne.mockResolvedValue(run);
    m.runFindById.mockResolvedValue(run);
    m.startSession.mockResolvedValue(fakeSession());
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runExists.mockResolvedValue(opts.pendingLeft ? { _id: run._id } : null);
  }

  it("single stop: stop write → order release → audit → pending check → completion, all with the transaction session, in that order", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    await skipStop(courier, run._id.toString(), stopIdOf(run));

    const [claimFilter, claimUpdate, claimOpts] = m.runUpdateOne.mock.calls[0]!;
    expect(claimFilter.status).toBe("active");
    expect(claimFilter.stops.$elemMatch.status).toBe("pending");
    expect(claimUpdate.$set["stops.$.status"]).toBe("skipped");
    expect(claimOpts).toHaveProperty("session");

    const [orderFilter, orderUpdate, orderOpts] = m.orderUpdateOne.mock.calls[0]!;
    expect(orderFilter._id.equals(run.stops[0]!.orderId)).toBe(true);
    expect(orderFilter["delivery.status"]).toBe("assigned");
    expect(orderFilter["delivery.courierId"].equals(courierId)).toBe(true);
    expect(orderUpdate.$set).toEqual({ "delivery.status": "unassigned" });
    expect(Object.keys(orderUpdate.$unset).sort()).toEqual(["delivery.assignedAt", "delivery.courierId"]);
    expect(orderOpts).toHaveProperty("session");

    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    const [[auditDoc], auditOpts] = m.auditCreate.mock.calls[0]!;
    expect(auditDoc).toMatchObject({ action: "deliveryRun.stop_skipped", entityType: "DeliveryRun" });
    expect(auditOpts).toHaveProperty("session"); // same transaction

    const done = m.runUpdateOne.mock.calls[1]!;
    expect(done[1].$set.status).toBe("completed");
    expect(done[2]).toHaveProperty("session");

    const order = (fn: { mock: { invocationCallOrder: number[] } }, i = 0) => fn.mock.invocationCallOrder[i]!;
    expect(order(m.runUpdateOne, 0)).toBeLessThan(order(m.orderUpdateOne));
    expect(order(m.orderUpdateOne)).toBeLessThan(order(m.auditCreate));
    expect(order(m.auditCreate)).toBeLessThan(order(m.runExists));
    expect(order(m.runExists)).toBeLessThan(order(m.runUpdateOne, 1));
  });

  it("another stop still pending → the run is NOT completed", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }]);
    arrangeActive(run, { pendingLeft: true });
    await skipStop(courier, run._id.toString(), stopIdOf(run));
    expect(m.runUpdateOne).toHaveBeenCalledTimes(1); // only the stop write, no completion write
  });

  it("never writes Order.status and never writes a skipped→pending revert", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    await skipStop(courier, run._id.toString(), stopIdOf(run));
    for (const call of m.runUpdateOne.mock.calls) {
      expect(JSON.stringify(call[1])).not.toContain('"pending"');
    }
    for (const call of m.orderUpdateOne.mock.calls) {
      expect(Object.keys(call[1].$set)).not.toContain("status");
    }
  });

  it("order no longer assigned (e.g. picked up) → ORDER_NOT_ASSIGNED, no audit entry, no completion", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(skipStop(courier, run._id.toString(), stopIdOf(run)), "ORDER_NOT_ASSIGNED", 409);
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.runExists).not.toHaveBeenCalled();
    expect(m.runUpdateOne).toHaveBeenCalledTimes(1); // the real transaction rolls the stop write back
  });

  it.each(["delivered", "failed", "skipped"])("a %s stop cannot be skipped (terminal)", async (status) => {
    const run = makeRun([{ seq: 1, status }, { seq: 2 }]);
    arrangeActive(run, { pendingLeft: true });
    await expectAppError(skipStop(courier, run._id.toString(), stopIdOf(run)), "DELIVERY_STOP_ALREADY_RESOLVED", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("stop write lost to a concurrent change → DELIVERY_RUN_CHANGED, no order write", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(skipStop(courier, run._id.toString(), stopIdOf(run)), "DELIVERY_RUN_CHANGED", 409);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it("authorization unchanged: courier-only; admin and customer are forbidden; another courier's run is a 404", async () => {
    for (const actor of [admin, customer]) {
      await expectAppError(skipStop(actor, id().toString(), id().toString()), "FORBIDDEN_ROLE", 403);
    }
    m.runFindOne.mockResolvedValue(null);
    m.startSession.mockResolvedValue(fakeSession());
    await expectAppError(skipStop(courier, id().toString(), id().toString()), "DELIVERY_RUN_NOT_FOUND", 404);
  });

  it("the first read of the run goes through the transaction session (findOne(...).session(...))", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    const sessionSpy = vi.fn();
    // Prove the call went through `.session()` rather than the session-less `.lean()` path.
    const { DeliveryRun } = await import("../models/DeliveryRun");
    const spy = vi.spyOn(DeliveryRun, "findOne").mockImplementation(((...a: unknown[]) => ({
      lean: () => {
        throw new Error("non-transactional read");
      },
      session: (sess: unknown) => {
        sessionSpy(sess);
        return { lean: () => m.runFindOne(...a) };
      },
    })) as never);
    await skipStop(courier, run._id.toString(), stopIdOf(run));
    expect(sessionSpy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("afterFirstRead hook: called once per callback execution (attempt 1), after the read and BEFORE any write", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    const seen: number[] = [];
    let writesAtHookTime = -1;
    await skipStop(courier, run._id.toString(), stopIdOf(run), {
      afterFirstRead: ({ attempt }) => {
        seen.push(attempt);
        writesAtHookTime = m.runUpdateOne.mock.calls.length + m.orderUpdateOne.mock.calls.length;
      },
    });
    expect(seen).toEqual([1]);
    expect(writesAtHookTime).toBe(0);
  });

  it("without a hook behaviour is identical (hook is purely optional)", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    await expect(skipStop(courier, run._id.toString(), stopIdOf(run))).resolves.toMatchObject({ id: run._id.toString() });
  });

  it("a TransientTransactionError thrown by a write reaches withTransaction untouched and the callback is re-executed (attempt 2); the hook sees both attempts", async () => {
    const run = makeRun([{ seq: 1 }]);
    arrangeActive(run, { pendingLeft: false });
    const transient = Object.assign(new Error("WriteConflict"), { code: 112, errorLabels: ["TransientTransactionError"] });
    m.runUpdateOne.mockRejectedValueOnce(transient).mockResolvedValue({ modifiedCount: 1 });
    // Retry loop that mimics ONLY the driver contract: retry iff the thrown error carries the label.
    m.startSession.mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => {
        for (;;) {
          try {
            return await fn();
          } catch (e) {
            if ((e as { errorLabels?: string[] }).errorLabels?.includes("TransientTransactionError")) continue;
            throw e;
          }
        }
      },
      endSession: vi.fn(),
    });
    const attempts: number[] = [];
    await skipStop(courier, run._id.toString(), stopIdOf(run), { afterFirstRead: ({ attempt }) => void attempts.push(attempt) });
    expect(attempts).toEqual([1, 2]);
  });

  it("a standalone mongod (transactions unsupported) yields a plain Error, not a silent non-transactional fallback", async () => {
    const run = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue({
      withTransaction: async () => {
        throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
      },
      endSession: vi.fn(),
    });
    const err = await skipStop(courier, run._id.toString(), stopIdOf(run)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).not.toBe("AppError");
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });
});
