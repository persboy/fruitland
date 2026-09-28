import { beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import type { AuthContext } from "../auth/guard";

const m = vi.hoisted(() => ({
  runFindOne: vi.fn(),
  runFindById: vi.fn(),
  runUpdateOne: vi.fn(),
  runFindOneAndUpdate: vi.fn(),
  runExists: vi.fn(),
  runCreate: vi.fn(),
  runDeleteOne: vi.fn(),
  orderUpdateOne: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderCount: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("../models/DeliveryRun", () => ({
  DeliveryRun: {
    findOne: (...a: unknown[]) => ({ lean: () => m.runFindOne(...a) }),
    findById: (...a: unknown[]) => ({ lean: () => m.runFindById(...a) }),
    findOneAndUpdate: (...a: unknown[]) => ({ lean: () => m.runFindOneAndUpdate(...a) }),
    updateOne: m.runUpdateOne,
    exists: m.runExists,
    create: m.runCreate,
    deleteOne: m.runDeleteOne,
  },
}));
vi.mock("../models/Order", () => ({
  Order: { updateOne: m.orderUpdateOne, updateMany: m.orderUpdateMany, countDocuments: m.orderCount },
}));
vi.mock("../models/User", () => ({ User: { findOne: m.userFindOne } }));

import {
  activateRun,
  cancelRun,
  confirmPickup,
  createDraftRun,
  getRun,
  proposeStopOutcome,
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
  it("customers and couriers cannot create, activate or cancel runs", async () => {
    for (const actor of [customer, courier]) {
      await expectAppError(createDraftRun(actor, { courierId: courierId.toString(), orderIds: [id().toString()] }), "FORBIDDEN_ROLE", 403);
      await expectAppError(activateRun(actor, id().toString()), "FORBIDDEN_ROLE", 403);
      await expectAppError(cancelRun(actor, id().toString()), "FORBIDDEN_ROLE", 403);
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

describe("reorderStops", () => {
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

  it("refuses an incomplete ordering", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
    m.runFindOne.mockResolvedValue(run);
    await expectAppError(reorderStops(courier, run._id.toString(), [run.stops[0]!._id.toString()]), "REORDER_INCOMPLETE", 400);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it.each(["draft", "completed", "cancelled"])("refuses to reorder a %s run", async (status) => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], status);
    m.runFindOne.mockResolvedValue(run);
    await expectAppError(reorderStops(courier, run._id.toString(), run.stops.map((s) => s._id.toString())), "DELIVERY_RUN_NOT_ACTIVE", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
  });

  it("reports a conflict when a stop was resolved between read and write", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }]);
    m.runFindOne.mockResolvedValue(run);
    m.runUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expectAppError(reorderStops(courier, run._id.toString(), run.stops.map((s) => s._id.toString())), "DELIVERY_RUN_CHANGED", 409);
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
    // The courier path never resolves an order or touches Order.status.
    const everyOrderWrite = JSON.stringify([...m.orderUpdateOne.mock.calls, ...m.orderUpdateMany.mock.calls]);
    expect(everyOrderWrite).not.toContain("resolved");
    expect(everyOrderWrite).not.toContain('"status":"shipped"');
    expect(everyOrderWrite).not.toContain('"status":"delivered"');
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

  it("does not touch the order when the stop could not be claimed", async () => {
    const run = arrange();
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 0, matchedCount: 0 });
    await expectAppError(proposeStopOutcome(courier, run._id.toString(), run.stops[0]!._id.toString(), "delivered"), "DELIVERY_RUN_CHANGED", 409);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
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

describe("createDraftRun — one order, one open run", () => {
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

  it("turns the unique-index violation into ORDER_ALREADY_IN_RUN and assigns nothing", async () => {
    arrange();
    m.runCreate.mockRejectedValue(Object.assign(new Error("E11000 duplicate key"), { code: 11000 }));
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString(), orderB.toString()] }), "ORDER_ALREADY_IN_RUN", 409);
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
  });

  it("claims each order from preparing/unassigned to assigned (the existing lifecycle step)", async () => {
    arrange();
    const runId = id();
    m.runCreate.mockResolvedValue({ _id: runId });
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
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

    expect(m.orderUpdateOne).toHaveBeenCalledTimes(2);
    const [filter, update] = m.orderUpdateOne.mock.calls[0]!;
    expect(filter).toMatchObject({ status: "preparing", "delivery.status": "unassigned" });
    expect(update.$set["delivery.status"]).toBe("assigned");
    // Order.status is never written by run creation.
    expect(Object.keys(update.$set)).not.toContain("status");
    expect(dto.stops.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("rolls back earlier claims and deletes the draft when a later order cannot be assigned", async () => {
    arrange();
    const runId = id();
    m.runCreate.mockResolvedValue({ _id: runId });
    m.orderUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 }).mockResolvedValueOnce({ modifiedCount: 0 });
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString(), orderB.toString()] }), "ORDER_NOT_ASSIGNABLE", 409);
    expect(m.orderUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.orderUpdateMany.mock.calls[0]![1]).toMatchObject({ $set: { "delivery.status": "unassigned" } });
    expect(m.runDeleteOne).toHaveBeenCalledTimes(1);
  });

  it("fails when an order does not exist", async () => {
    m.userFindOne.mockResolvedValue({ courierProfile: { vehicleType: "car" } });
    m.orderCount.mockResolvedValue(1);
    await expectAppError(createDraftRun(admin, { courierId: courierId.toString(), orderIds: [orderA.toString(), orderB.toString()] }), "ORDER_NOT_FOUND", 404);
    expect(m.runCreate).not.toHaveBeenCalled();
  });
});

describe("cancelRun", () => {
  it("refuses once any order has been picked up, and releases nothing", async () => {
    const run = makeRun([{ seq: 1 }, { seq: 2 }], "active");
    m.runFindById.mockResolvedValue(run);
    m.orderCount.mockResolvedValue(1);
    await expectAppError(cancelRun(admin, run._id.toString()), "RUN_HAS_PICKED_UP_ORDERS", 409);
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateMany).not.toHaveBeenCalled();
  });

  it("cancels a draft run and releases only assignments that were never picked up", async () => {
    const run = makeRun([{ seq: 1 }], "draft");
    m.runFindById.mockResolvedValue(run);
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

describe("activateRun", () => {
  it("distinguishes a missing run from one that is not a draft", async () => {
    m.runFindOneAndUpdate.mockResolvedValue(null);
    m.runExists.mockResolvedValueOnce(null);
    await expectAppError(activateRun(admin, id().toString()), "DELIVERY_RUN_NOT_FOUND", 404);
    m.runExists.mockResolvedValueOnce({ _id: id() });
    await expectAppError(activateRun(admin, id().toString()), "INVALID_RUN_TRANSITION", 409);
  });
});
