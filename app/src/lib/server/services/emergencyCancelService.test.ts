import { beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import type { AuthContext } from "../auth/guard";

const m = vi.hoisted(() => ({
  reqFindById: vi.fn(),
  reqFindOne: vi.fn(),
  reqUpdateOne: vi.fn(),
  reqCreate: vi.fn(),
  runFindOne: vi.fn(),
  runUpdateOne: vi.fn(),
  orderCount: vi.fn(),
  orderFindOneAndUpdate: vi.fn(),
  orderUpdateOne: vi.fn(),
  orderCreate: vi.fn(),
  auditCreate: vi.fn(),
  getNextOrderNumber: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("../models/DeliveryRunEmergencyCancelRequest", () => ({
  DeliveryRunEmergencyCancelRequest: {
    findById: (...a: unknown[]) => ({ lean: () => m.reqFindById(...a) }),
    findOne: (...a: unknown[]) => ({ lean: () => m.reqFindOne(...a) }),
    updateOne: m.reqUpdateOne,
    create: m.reqCreate,
  },
}));
vi.mock("../models/DeliveryRun", () => ({
  DeliveryRun: {
    // Supports both `.lean()` directly (requestEmergencyCancel) and `.session(s).lean()` (approval, inside the transaction).
    findOne: (...a: unknown[]) => ({ lean: () => m.runFindOne(...a), session: () => ({ lean: () => m.runFindOne(...a) }) }),
    updateOne: m.runUpdateOne,
  },
}));
vi.mock("../models/Order", () => ({
  Order: {
    countDocuments: m.orderCount,
    findOneAndUpdate: m.orderFindOneAndUpdate,
    updateOne: m.orderUpdateOne,
    create: m.orderCreate,
  },
}));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));
// Not used directly by emergencyCancelService — mocked only because importing
// isDuplicateKeyError/isTransactionsUnsupportedError from deliveryRunService.ts
// transitively loads it, and the real model touches the real mongoose `models`/`model`.
vi.mock("../models/User", () => ({ User: {} }));
vi.mock("../models/OrderCounter", () => ({ getNextOrderNumber: m.getNextOrderNumber }));
vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();
  return { ...actual, startSession: m.startSession };
});

import {
  getEmergencyCancelRequest,
  recordPhysicalReturn,
  requestEmergencyCancel,
  reviewEmergencyCancelRequest,
} from "./emergencyCancelService";

const id = () => new Types.ObjectId();
const courierId = id();
const otherCourierId = id();
const adminId = id();
const runId = id();

const admin: AuthContext = { userId: adminId.toString(), role: "admin" };
const courier: AuthContext = { userId: courierId.toString(), role: "courier" };
const otherCourier: AuthContext = { userId: otherCourierId.toString(), role: "courier" };
const customer: AuthContext = { userId: id().toString(), role: "customer" };

function fakeSession() {
  return { withTransaction: async (fn: () => Promise<void>) => fn(), endSession: vi.fn() };
}

async function expectAppError(promise: Promise<unknown>, code: string, status?: number) {
  await expect(promise).rejects.toMatchObject({ name: "AppError", code, ...(status ? { status } : {}) });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("requestEmergencyCancel", () => {
  const stop1 = { orderId: id() };
  const stop2 = { orderId: id() };

  function arrange(status = "active") {
    m.runFindOne.mockResolvedValue({ status, stops: [stop1, stop2] });
    m.orderCount.mockResolvedValue(1);
  }

  it("rejects non-couriers before touching the database", async () => {
    for (const actor of [admin, customer]) {
      await expectAppError(requestEmergencyCancel(actor, runId.toString(), "دلیل"), "FORBIDDEN_ROLE", 403);
    }
    expect(m.runFindOne).not.toHaveBeenCalled();
  });

  it("requires a non-empty reason", async () => {
    await expectAppError(requestEmergencyCancel(courier, runId.toString(), "   "), "EMERGENCY_CANCEL_REASON_REQUIRED", 400);
    expect(m.runFindOne).not.toHaveBeenCalled();
  });

  it("looks the run up by id AND the acting courier — another courier's run is 404, not 403", async () => {
    m.runFindOne.mockResolvedValue(null);
    await expectAppError(requestEmergencyCancel(otherCourier, runId.toString(), "دلیل"), "DELIVERY_RUN_NOT_FOUND", 404);
    const query = m.runFindOne.mock.calls[0]![0] as { _id: Types.ObjectId; courierId: Types.ObjectId };
    expect(query.courierId.equals(otherCourierId)).toBe(true);
  });

  it("refuses for a non-active run", async () => {
    arrange("draft");
    await expectAppError(requestEmergencyCancel(courier, runId.toString(), "دلیل"), "DELIVERY_RUN_NOT_ACTIVE", 409);
    expect(m.reqCreate).not.toHaveBeenCalled();
  });

  it("refuses when nothing in the run is picked_up yet", async () => {
    arrange();
    m.orderCount.mockResolvedValue(0);
    await expectAppError(requestEmergencyCancel(courier, runId.toString(), "دلیل"), "EMERGENCY_CANCEL_NO_PICKED_UP_ORDERS", 409);
    expect(m.reqCreate).not.toHaveBeenCalled();
    expect(m.orderCount.mock.calls[0]![0]._id.$in).toHaveLength(2);
  });

  it("creates a pending request and writes an audit entry", async () => {
    arrange();
    const createdId = id();
    m.reqCreate.mockResolvedValue({ _id: createdId, reason: "پیک تصادف کرد" });
    m.reqFindById.mockResolvedValue({
      _id: createdId,
      deliveryRunId: runId,
      requestedByCourierId: courierId,
      reason: "پیک تصادف کرد",
      status: "pending",
      requestedAt: new Date(),
      replacementOrderIds: [],
    });

    const dto = await requestEmergencyCancel(courier, runId.toString(), "  پیک تصادف کرد  ");
    expect(dto.status).toBe("pending");
    expect(m.reqCreate.mock.calls[0]![0]).toMatchObject({ status: "pending", reason: "پیک تصادف کرد" });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "deliveryRun.emergency_cancel_requested" });
  });

  it("maps a duplicate pending request to a domain conflict", async () => {
    arrange();
    m.reqCreate.mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 }));
    await expectAppError(requestEmergencyCancel(courier, runId.toString(), "دلیل"), "EMERGENCY_CANCEL_REQUEST_ALREADY_PENDING", 409);
  });
});

describe("reviewEmergencyCancelRequest — authorization and idempotency", () => {
  function pendingRequest() {
    return {
      _id: id(),
      deliveryRunId: runId,
      requestedByCourierId: courierId,
      reason: "r",
      status: "pending",
      requestedAt: new Date(),
      replacementOrderIds: [],
    };
  }

  it("only an admin may review", async () => {
    m.reqFindById.mockResolvedValue(pendingRequest());
    for (const actor of [courier, customer]) {
      await expectAppError(reviewEmergencyCancelRequest(actor, id().toString(), "approve"), "FORBIDDEN_ROLE", 403);
    }
  });

  it("reviewing an already-rejected request with 'reject' again is an idempotent no-op", async () => {
    const req = { ...pendingRequest(), status: "rejected", rejectionReason: "قبلاً رد شد" };
    m.reqFindById.mockResolvedValue(req);
    const dto = await reviewEmergencyCancelRequest(admin, req._id.toString(), "reject", "دلیل دیگر");
    expect(dto.status).toBe("rejected");
    expect(m.reqUpdateOne).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("reviewing an already-approved request with 'approve' again is an idempotent no-op (no second transaction)", async () => {
    const req = { ...pendingRequest(), status: "approved", replacementOrderIds: [id()] };
    m.reqFindById.mockResolvedValue(req);
    const dto = await reviewEmergencyCancelRequest(admin, req._id.toString(), "approve");
    expect(dto.status).toBe("approved");
    expect(m.startSession).not.toHaveBeenCalled();
  });

  it("reviewing a rejected request with 'approve' (opposite decision) is a real conflict, not a no-op", async () => {
    const req = { ...pendingRequest(), status: "rejected" };
    m.reqFindById.mockResolvedValue(req);
    await expectAppError(reviewEmergencyCancelRequest(admin, req._id.toString(), "approve"), "EMERGENCY_CANCEL_ALREADY_REVIEWED", 409);
    expect(m.startSession).not.toHaveBeenCalled();
  });

  it("reviewing an approved request with 'reject' (opposite decision) is a real conflict", async () => {
    const req = { ...pendingRequest(), status: "approved" };
    m.reqFindById.mockResolvedValue(req);
    await expectAppError(reviewEmergencyCancelRequest(admin, req._id.toString(), "reject", "دلیل"), "EMERGENCY_CANCEL_ALREADY_REVIEWED", 409);
  });
});

describe("reviewEmergencyCancelRequest — reject path", () => {
  function pendingRequest() {
    return { _id: id(), deliveryRunId: runId, requestedByCourierId: courierId, reason: "r", status: "pending", requestedAt: new Date(), replacementOrderIds: [] };
  }

  it("requires a non-empty rejection reason", async () => {
    m.reqFindById.mockResolvedValue(pendingRequest());
    await expectAppError(reviewEmergencyCancelRequest(admin, id().toString(), "reject", "  "), "EMERGENCY_CANCEL_REJECTION_REASON_REQUIRED", 400);
    expect(m.reqUpdateOne).not.toHaveBeenCalled();
  });

  it("writes rejected + reason, touches no run or order, and audits", async () => {
    const req = pendingRequest();
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "rejected", rejectionReason: "مشکل حل شد" });
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 1 });

    const dto = await reviewEmergencyCancelRequest(admin, req._id.toString(), "reject", "مشکل حل شد");
    expect(dto.status).toBe("rejected");
    const [filter, update] = m.reqUpdateOne.mock.calls[0]!;
    expect(filter).toMatchObject({ status: "pending" });
    expect(update.$set).toMatchObject({ status: "rejected", rejectionReason: "مشکل حل شد" });
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
    expect(m.orderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "deliveryRun.emergency_cancel_rejected" });
  });

  it("a race where another reviewer rejected first resolves as an idempotent no-op", async () => {
    const req = pendingRequest();
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "rejected" });
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const dto = await reviewEmergencyCancelRequest(admin, req._id.toString(), "reject", "دلیل");
    expect(dto.status).toBe("rejected");
  });

  it("a race where another reviewer approved first is a real conflict", async () => {
    const req = pendingRequest();
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "approved" });
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(reviewEmergencyCancelRequest(admin, req._id.toString(), "reject", "دلیل"), "EMERGENCY_CANCEL_ALREADY_REVIEWED", 409);
  });
});

describe("reviewEmergencyCancelRequest — approve path (transactional)", () => {
  const orderA = {
    _id: id(),
    userId: id(),
    source: "online",
    items: [{ a: 1 }],
    deliveryAddress: { city: "X" },
    subtotalAmount: 10,
    discountAmount: 0,
    deliveryFeeAmount: 1,
    totalAmount: 11,
    paymentMethod: "cod",
  };
  const orderB = { _id: id() };

  function pendingRequest() {
    return { _id: id(), deliveryRunId: runId, requestedByCourierId: courierId, reason: "r", status: "pending", requestedAt: new Date(), replacementOrderIds: [] };
  }
  function arrange(req: ReturnType<typeof pendingRequest>) {
    m.reqFindById.mockResolvedValue(req);
    m.startSession.mockResolvedValue(fakeSession());
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.runFindOne.mockResolvedValue({ _id: runId, courierId, stops: [{ orderId: orderA._id }, { orderId: orderB._id }] });
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  }

  it("claims the request, cancels the run, and processes each order by its CURRENT state", async () => {
    const req = pendingRequest();
    arrange(req);
    m.orderFindOneAndUpdate.mockResolvedValueOnce(orderA).mockResolvedValueOnce(null); // A is picked_up, B is not
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 }); // B released as assigned->unassigned
    m.getNextOrderNumber.mockResolvedValue("000123");
    const replacementId = id();
    m.orderCreate.mockResolvedValue([{ _id: replacementId }]);
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "approved", replacementOrderIds: [replacementId] });

    const dto = await reviewEmergencyCancelRequest(admin, req._id.toString(), "approve");

    expect(dto.status).toBe("approved");
    const [reqFilter, reqUpdate] = m.reqUpdateOne.mock.calls[0]!;
    expect(reqFilter).toMatchObject({ status: "pending" });
    expect(reqUpdate.$set.status).toBe("approved");
    const [runFilter, runUpdate] = m.runUpdateOne.mock.calls[0]!;
    expect(runFilter).toMatchObject({ _id: runId, status: "active" });
    expect(runUpdate.$set.status).toBe("cancelled");

    const [pickedUpFilter, pickedUpUpdate] = m.orderFindOneAndUpdate.mock.calls[0]!;
    expect(pickedUpFilter).toMatchObject({ "delivery.status": "picked_up" });
    expect(pickedUpUpdate.$set["delivery.status"]).toBe("emergency_cancelled");
    const replacementInput = m.orderCreate.mock.calls[0]![0][0];
    expect(replacementInput).toMatchObject({ orderNumber: "000123", replacesOrderId: orderA._id, userId: orderA.userId, totalAmount: orderA.totalAmount });

    const [releasedFilter, releasedUpdate] = m.orderUpdateOne.mock.calls[0]!;
    expect(releasedFilter).toMatchObject({ _id: orderB._id, "delivery.status": "assigned" });
    expect(releasedUpdate.$set["delivery.status"]).toBe("unassigned");

    const everyOrderWrite = JSON.stringify([...m.orderFindOneAndUpdate.mock.calls, ...m.orderUpdateOne.mock.calls, ...m.orderCreate.mock.calls]);
    expect(everyOrderWrite).not.toContain("courierProfile");
    expect(Object.keys(replacementInput)).not.toContain("status");
  });

  it("leaves an order untouched if it already moved past assigned/picked_up by the time of the write (race-safety)", async () => {
    const req = pendingRequest();
    arrange(req);
    m.orderFindOneAndUpdate.mockResolvedValue(null); // not picked_up anymore
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 0 }); // not assigned anymore either (e.g. already proposed)
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "approved" });

    await reviewEmergencyCancelRequest(admin, req._id.toString(), "approve");
    expect(m.orderCreate).not.toHaveBeenCalled();
  });

  it("creates no replacement and skips the replacementOrderIds write when nothing was picked_up", async () => {
    const req = pendingRequest();
    arrange(req);
    m.orderFindOneAndUpdate.mockResolvedValue(null);
    m.orderUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "approved" });

    await reviewEmergencyCancelRequest(admin, req._id.toString(), "approve");
    expect(m.orderCreate).not.toHaveBeenCalled();
    expect(m.reqUpdateOne).toHaveBeenCalledTimes(1);
  });

  it("aborts entirely — no run cancellation, no replacement — when another admin already claimed the request", async () => {
    const req = pendingRequest();
    arrange(req);
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "approved" });

    const dto = await reviewEmergencyCancelRequest(admin, req._id.toString(), "approve");
    expect(dto.status).toBe("approved");
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderCreate).not.toHaveBeenCalled();
  });

  it("reports a conflict (not an idempotent no-op) if the claim loses the race and the request did not end up approved", async () => {
    const req = pendingRequest();
    arrange(req);
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "pending" });
    await expectAppError(reviewEmergencyCancelRequest(admin, req._id.toString(), "approve"), "EMERGENCY_CANCEL_ALREADY_REVIEWED", 409);
  });

  it("reports a conflict when the run is no longer active, and makes no order changes", async () => {
    const req = pendingRequest();
    arrange(req);
    m.runFindOne.mockResolvedValue(null);
    await expectAppError(reviewEmergencyCancelRequest(admin, req._id.toString(), "approve"), "DELIVERY_RUN_NOT_ACTIVE", 409);
    expect(m.orderFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports a conflict when the run's own cancellation write does not match", async () => {
    const req = pendingRequest();
    arrange(req);
    m.runUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    await expectAppError(reviewEmergencyCancelRequest(admin, req._id.toString(), "approve"), "DELIVERY_RUN_CHANGED", 409);
    expect(m.orderFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports the environment limitation — not a silent non-transactional fallback — when the deployment cannot run transactions", async () => {
    const req = pendingRequest();
    m.reqFindById.mockResolvedValue(req);
    const err = Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 });
    m.startSession.mockResolvedValue({
      withTransaction: async () => {
        throw err;
      },
      endSession: vi.fn(),
    });
    await expect(reviewEmergencyCancelRequest(admin, req._id.toString(), "approve")).rejects.toMatchObject({
      message: expect.stringContaining("replica set"),
    });
    await expect(reviewEmergencyCancelRequest(admin, req._id.toString(), "approve")).rejects.not.toMatchObject({ name: "AppError" });
  });

  it("always ends the session, even on failure", async () => {
    const req = pendingRequest();
    arrange(req);
    const session = fakeSession();
    m.startSession.mockResolvedValue(session);
    m.reqUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    m.reqFindById.mockResolvedValueOnce(req).mockResolvedValueOnce({ ...req, status: "rejected" });
    await reviewEmergencyCancelRequest(admin, req._id.toString(), "approve").catch(() => {});
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("recordPhysicalReturn", () => {
  function approvedRequest() {
    return { _id: id(), deliveryRunId: runId, requestedByCourierId: courierId, reason: "r", status: "approved", requestedAt: new Date(), replacementOrderIds: [] };
  }

  it("only an admin may record physical return", async () => {
    m.reqFindById.mockResolvedValue(approvedRequest());
    for (const actor of [courier, customer]) {
      await expectAppError(recordPhysicalReturn(actor, id().toString(), true), "FORBIDDEN_ROLE", 403);
    }
    expect(m.reqUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses when the request is not approved yet", async () => {
    m.reqFindById.mockResolvedValue({ ...approvedRequest(), status: "pending" });
    await expectAppError(recordPhysicalReturn(admin, id().toString(), true), "EMERGENCY_CANCEL_NOT_APPROVED", 409);
    expect(m.reqUpdateOne).not.toHaveBeenCalled();
  });

  it.each([true, false])("records returned=%s and audits it, without touching the run or any order", async (returned) => {
    const req = approvedRequest();
    m.reqFindById
      .mockResolvedValueOnce(req)
      .mockResolvedValueOnce({ ...req, physicalReturn: { returned, recordedByAdminUserId: adminId, recordedAt: new Date() } });
    const dto = await recordPhysicalReturn(admin, req._id.toString(), returned);
    expect(dto.physicalReturn?.returned).toBe(returned);
    expect(m.reqUpdateOne.mock.calls[0]![1].$set.physicalReturn).toMatchObject({ returned });
    expect(m.runUpdateOne).not.toHaveBeenCalled();
    expect(m.orderUpdateOne).not.toHaveBeenCalled();
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "deliveryRun.emergency_cancel_physical_return_recorded" });
  });
});

describe("getEmergencyCancelRequest", () => {
  it("a courier sees only their own request (ownership via query, 404 for anyone else's)", async () => {
    m.reqFindOne.mockResolvedValue(null);
    await expectAppError(getEmergencyCancelRequest(otherCourier, id().toString()), "EMERGENCY_CANCEL_REQUEST_NOT_FOUND", 404);
    expect(m.reqFindOne.mock.calls[0]![0]).toMatchObject({ requestedByCourierId: otherCourierId });
  });

  it("an admin can read any request by id", async () => {
    m.reqFindById.mockResolvedValue({
      _id: id(),
      deliveryRunId: runId,
      requestedByCourierId: courierId,
      reason: "r",
      status: "pending",
      requestedAt: new Date(),
      replacementOrderIds: [],
    });
    const dto = await getEmergencyCancelRequest(admin, id().toString());
    expect(dto.status).toBe("pending");
  });

  it("customers cannot read a request", async () => {
    await expectAppError(getEmergencyCancelRequest(customer, id().toString()), "FORBIDDEN_ROLE", 403);
  });
});
