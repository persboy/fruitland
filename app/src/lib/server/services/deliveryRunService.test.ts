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
    m.userUpdateOne.mockResolvedValue({ matchedCount: 1 }); // the courier is an active courier account, by default
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

  it("Page 8: re-checks the courier's CURRENT account state inside the transaction with a conditional WRITE on the courier's User (so it conflicts with a concurrent deactivation)", async () => {
    const run = arrangeDraft([{ orderId: id() }]);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "active" });
    await activateRun(admin, run._id.toString());
    const [filter, update, options] = m.userUpdateOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: courierId, role: "courier", isActive: true });
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(options).toHaveProperty("session");
    expect(m.userUpdateOne.mock.invocationCallOrder[0]!).toBeLessThan(m.orderUpdateOne.mock.invocationCallOrder[0]!);
  });

  it("Page 8: a deactivated (or no-longer-courier) courier cannot activate a run — 409 COURIER_NOT_ACTIVE, no order touched, no flip", async () => {
    arrangeDraft([{ orderId: id() }, { orderId: id() }]);
    m.userUpdateOne.mockResolvedValue({ matchedCount: 0 });
    await expectAppError(activateRun(admin, id().toString()), "COURIER_NOT_ACTIVE", 409);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
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

  // ---- Decision 8: active cancelRun is one transaction; decision made from session reads ----
  const activeCancelSetup = (run: ReturnType<typeof makeRun>) => {
    m.runFindById.mockResolvedValue(run); // branch probe only
    m.runFindOne.mockResolvedValue(run); // transactional read
    m.startSession.mockResolvedValue(fakeSession());
  };

  it("D8 #1: active run, assigned orders, none picked up → run cancelled, each relevant order released in the transaction", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(0);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateMany.mockResolvedValue({ modifiedCount: 2 });
    await cancelRun(admin, run._id.toString());
    expect(m.startSession).toHaveBeenCalledTimes(1);
    expect(m.runUpdateOne.mock.calls[0]![0]).toMatchObject({ _id: run._id, status: "active" });
    expect(m.runUpdateOne.mock.calls[0]![2]).toHaveProperty("session");
    const [filter, update, options] = m.orderUpdateMany.mock.calls[0]!;
    expect(filter).toMatchObject({ "delivery.status": "assigned", "delivery.courierId": courierId });
    expect(filter._id.$in).toHaveLength(2);
    expect(update.$set).toEqual({ "delivery.status": "unassigned" });
    expect(options).toHaveProperty("session");
    expect(m.orderCount.mock.calls[0]![1]).toHaveProperty("session");
    expect(m.auditCreate).not.toHaveBeenCalled(); // Owner decision: no AuditLog on cancelRun
  });

  it("D8 #2: active run with a picked-up order → RUN_HAS_PICKED_UP_ORDERS; run not claimed, nothing released", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(1);
    await expectAppError(cancelRun(admin, run._id.toString()), "RUN_HAS_PICKED_UP_ORDERS", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("D8 #3: a SKIPPED stop is ignored — its order is neither checked nor released; cancellation succeeds", async () => {
    const run = makeRun([{ seq: 1, status: "skipped" }, { seq: 2 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(0);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    await cancelRun(admin, run._id.toString());
    const skippedOrderId = run.stops[0]!.orderId;
    const pendingOrderId = run.stops[1]!.orderId;
    const countIds = m.orderCount.mock.calls[0]![0]._id.$in as Types.ObjectId[];
    const releaseIds = m.orderUpdateMany.mock.calls[0]![0]._id.$in as Types.ObjectId[];
    for (const ids of [countIds, releaseIds]) {
      expect(ids.map(String)).toEqual([pendingOrderId.toString()]);
      expect(ids.map(String)).not.toContain(skippedOrderId.toString());
    }
    expect(m.orderUpdateMany.mock.calls[0]![0]).toMatchObject({ "delivery.status": "assigned" });
    // the stop itself is never rewritten by cancel (only the run status is $set)
    expect(Object.keys(m.runUpdateOne.mock.calls[0]![1].$set).sort()).toEqual(["cancelledAt", "cancelledByUserId", "status"]);
  });

  it("D8: delivered/failed stops stay relevant (their order is past assigned) → still rejected, existing policy preserved", async () => {
    const run = makeRun([{ seq: 1, status: "delivered" }, { seq: 2 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(1);
    await expectAppError(cancelRun(admin, run._id.toString()), "RUN_HAS_PICKED_UP_ORDERS", 409);
    expect(m.orderCount.mock.calls[0]![0]._id.$in).toHaveLength(2);
  });

  it("D8 #4: release mismatch throws and the transaction is aborted (the callback's error propagates; no compensation write)", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(0);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateMany.mockResolvedValue({ modifiedCount: 1 }); // expected 2
    const session = { withTransaction: vi.fn(async (fn: () => Promise<void>) => fn()), endSession: vi.fn() };
    m.startSession.mockResolvedValue(session);
    await expectAppError(cancelRun(admin, run._id.toString()), "RUN_ORDER_RELEASE_MISMATCH", 409);
    expect(session.endSession).toHaveBeenCalled();
    // rollback is MongoDB's job (withTransaction aborts on throw); the service performs no undo write
    expect(m.runUpdateOne).toHaveBeenCalledTimes(1);
    expect(m.orderUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it("D8: the run is claimed with an `active` condition; losing that claim throws DELIVERY_RUN_CHANGED before any order is written", async () => {
    const run = makeRun([{ seq: 1 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(0);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(cancelRun(admin, run._id.toString()), "DELIVERY_RUN_CHANGED", 409);
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("D8: decision is re-made inside the transaction — a retry that now sees a picked-up order rejects (no cancellation)", async () => {
    const run = makeRun([{ seq: 1 }], "active");
    m.runFindById.mockResolvedValue(run);
    m.runFindOne.mockResolvedValue(run);
    const transient = Object.assign(new Error("WriteConflict"), { code: 112, errorLabels: ["TransientTransactionError"] });
    m.orderCount.mockResolvedValueOnce(0).mockResolvedValue(1); // attempt 1: all assigned; attempt 2: pickup committed
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateMany.mockRejectedValueOnce(transient);
    m.startSession.mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          if ((e as { errorLabels?: string[] }).errorLabels?.includes("TransientTransactionError")) return fn();
          throw e;
        }
      },
      endSession: vi.fn(),
    });
    await expectAppError(cancelRun(admin, run._id.toString()), "RUN_HAS_PICKED_UP_ORDERS", 409);
    expect(m.orderCount).toHaveBeenCalledTimes(2);
  });

  it("D8: the optional hook fires once per transaction execution, after the first session read and before any write", async () => {
    const run = makeRun([{ seq: 1 }], "active");
    activeCancelSetup(run);
    m.orderCount.mockResolvedValue(0);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.orderUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    const seen: Array<{ attempt: number; writesSoFar: number }> = [];
    await cancelRun(admin, run._id.toString(), {
      afterFirstRead: ({ attempt }) => {
        seen.push({ attempt, writesSoFar: m.runUpdateOne.mock.calls.length + m.orderUpdateMany.mock.calls.length });
      },
    });
    expect(seen).toEqual([{ attempt: 1, writesSoFar: 0 }]);
  });

  it("D8: unsupported-transaction deployments surface the existing plain Error (not AppError) for an ACTIVE run", async () => {
    const run = makeRun([{ seq: 1 }], "active");
    m.runFindById.mockResolvedValue(run);
    const err = Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
    m.startSession.mockResolvedValue({ withTransaction: async () => { throw err; }, endSession: vi.fn() });
    await expect(cancelRun(admin, run._id.toString())).rejects.not.toMatchObject({ name: "AppError" });
    expect(m.startSession).toHaveBeenCalledTimes(1);
  });

  it("D8: a DRAFT cancel stays non-transactional", async () => {
    const run = makeRun([{ seq: 1 }], "draft");
    m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "cancelled" });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await cancelRun(admin, run._id.toString());
    expect(m.startSession).not.toHaveBeenCalled();
  });

  it("D8 #5: repeated cancellation → existing INVALID_RUN_TRANSITION; nothing released twice", async () => {
    const run = makeRun([{ seq: 1 }], "cancelled");
    m.runFindById.mockResolvedValue(run);
    await expectAppError(cancelRun(admin, run._id.toString()), "INVALID_RUN_TRANSITION", 409);
    expect(m.startSession).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it("D8: a transactional re-read that finds the run already cancelled (concurrent cancel won) → INVALID_RUN_TRANSITION, no release", async () => {
    const run = makeRun([{ seq: 1 }], "active");
    m.runFindById.mockResolvedValue(run);
    m.runFindOne.mockResolvedValue({ ...run, status: "cancelled" });
    m.startSession.mockResolvedValue(fakeSession());
    await expectAppError(cancelRun(admin, run._id.toString()), "INVALID_RUN_TRANSITION", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("D8 #6: authorization unchanged — admin and master_admin may cancel; courier, customer and unknown roles are rejected before any DB access", async () => {
    const run = makeRun([{ seq: 1 }], "draft");
    for (const role of ["admin", "master_admin"] as const) {
      vi.resetAllMocks();
      m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "cancelled" });
      m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      await expect(cancelRun({ userId: adminId.toString(), role }, run._id.toString())).resolves.toBeDefined();
    }
    for (const actor of [courier, customer]) {
      vi.resetAllMocks();
      await expectAppError(cancelRun(actor, id().toString()), "FORBIDDEN_ROLE", 403);
      noDbTouched();
    }
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

  /** Mimics ONLY the driver contract: re-run the callback while the error carries TransientTransactionError. */
  function retryingSession() {
    return {
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
    };
  }
  const transient = () => Object.assign(new Error("WriteConflict"), { code: 112, errorLabels: ["TransientTransactionError"] });

  it("Decision 7 race: a retry whose originally intended stop was skipped by a winning skipStop REJECTS — never a successful count-0", async () => {
    const run = makeRun([{ seq: 1 }]);
    const afterSkip = { ...run, stops: run.stops.map((s) => ({ ...s, status: "skipped" })) }; // run still "active" here on purpose: multi-stop-shaped snapshot
    m.runFindOne.mockResolvedValueOnce(run).mockResolvedValue(afterSkip);
    m.startSession.mockResolvedValue(retryingSession());
    m.orderUpdateOne.mockRejectedValueOnce(transient()); // lost the Order write conflict to skipStop
    await expectAppError(confirmPickup(courier, run._id.toString()), "PICKUP_STOP_NO_LONGER_PENDING", 409);
    expect(m.orderUpdateOne).toHaveBeenCalledTimes(1); // the retry never wrote anything
  });

  it("same race when the skip also completed the run (run no longer active on retry) → still rejects, not NOT_ACTIVE-then-success", async () => {
    const run = makeRun([{ seq: 1 }]);
    const completed = { ...run, status: "completed", stops: run.stops.map((s) => ({ ...s, status: "skipped" })) };
    m.runFindOne.mockResolvedValueOnce(run).mockResolvedValue(completed);
    m.startSession.mockResolvedValue(retryingSession());
    m.orderUpdateOne.mockRejectedValueOnce(transient());
    await expectAppError(confirmPickup(courier, run._id.toString()), "PICKUP_STOP_NO_LONGER_PENDING", 409);
  });

  it("race, multi-stop: if ANY originally intended stop vanished on retry the whole pickup rejects (all-or-nothing), even though another stop is still pending", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }]);
    const afterSkip = { ...run, stops: [{ ...run.stops[0]!, status: "skipped" }, run.stops[1]!] };
    m.runFindOne.mockResolvedValueOnce(run).mockResolvedValue(afterSkip);
    m.startSession.mockResolvedValue(retryingSession());
    m.orderUpdateOne.mockRejectedValueOnce(transient());
    await expectAppError(confirmPickup(courier, run._id.toString()), "PICKUP_STOP_NO_LONGER_PENDING", 409);
  });

  it("a retry caused by an unrelated transient error, with the intended stops still pending, still completes the pickup", async () => {
    const run = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(run);
    m.startSession.mockResolvedValue(retryingSession());
    m.orderUpdateOne.mockRejectedValueOnce(transient()).mockResolvedValue({ modifiedCount: 1 });
    expect((await confirmPickup(courier, run._id.toString())).pickedUpCount).toBe(1);
  });

  it("the intended work is fixed on attempt 1 and NOT recomputed on retry (a stop that became pending later is not picked up)", async () => {
    const run = makeRun([{ seq: 1, status: "delivered" }, { seq: 2 }]);
    const later = { ...run, stops: run.stops.map((s) => ({ ...s })) };
    m.runFindOne.mockResolvedValueOnce(run).mockResolvedValue(later);
    m.startSession.mockResolvedValue(retryingSession());
    m.orderUpdateOne.mockRejectedValueOnce(transient()).mockResolvedValue({ modifiedCount: 1 });
    expect((await confirmPickup(courier, run._id.toString())).pickedUpCount).toBe(1);
    expect(m.orderUpdateOne.mock.calls.at(-1)![0]._id.equals(run.stops[1]!.orderId)).toBe(true);
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
    m.userUpdateOne.mockResolvedValue({ matchedCount: 1 }); // Page 8 courier-eligibility guard
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
        m.runFindOne.mockResolvedValue(run);
        m.startSession.mockResolvedValue(fakeSession());
        m.orderCount.mockResolvedValue(0);
        m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
        m.orderUpdateMany.mockResolvedValue({ modifiedCount: 1 });
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
      // activateRun never READS the courier's User document (it only runs the Page 8 account-state
      // guard below) — 'status' here only documents which value this scenario represents.
      void status;
      const run = { _id: id(), courierId, status: "draft", stops: [{ _id: id(), orderId: id(), sequence: 1, status: "pending" }] };
      m.runFindById.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "active" });
      m.startSession.mockResolvedValue(fakeSession());
      m.runExists.mockResolvedValue(null);
      m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
      m.userUpdateOne.mockResolvedValue({ matchedCount: 1 });

      const active = await activateRun(admin, run._id.toString());
      expect(active.status).toBe("active");
      expect(m.userFindOne).not.toHaveBeenCalled();
      // Page 8: the only User access is the account-state guard — it never filters on courierProfile.status.
      expect(m.userUpdateOne.mock.calls[0]![0]).toEqual({ _id: courierId, role: "courier", isActive: true });
    },
  );

  it("no DeliveryRun operation ever mutates courierProfile.status — the ONLY User write is activateRun's account-state guard, which touches updatedAt alone", async () => {
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
    m.userUpdateOne.mockResolvedValue({ matchedCount: 1 });
    await activateRun(admin, draftId.toString());

    const activeRun = makeRun([{ seq: 1 }]);
    m.runFindOne.mockResolvedValue(activeRun);
    m.startSession.mockResolvedValue(fakeSession());
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    await confirmPickup(courier, activeRun._id.toString());

    // Exactly one User write happened (activateRun's guard), and it can only set updatedAt.
    expect(m.userUpdateOne).toHaveBeenCalledTimes(1);
    expect(Object.keys(m.userUpdateOne.mock.calls[0]![1].$set)).toEqual(["updatedAt"]);
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
