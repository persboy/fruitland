import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestReplSetDb, stopTestReplSetDb, clearTestReplSetDb } from "../models/testDbReplSet";
import { AuditLog } from "../models/AuditLog";
import { DeliveryRun } from "../models/DeliveryRun";
import { DeliveryRunEmergencyCancelRequest } from "../models/DeliveryRunEmergencyCancelRequest";
import { Order } from "../models/Order";
import { User } from "../models/User";
import type { AuthContext } from "../auth/guard";
import { activateRun, cancelRun, confirmPickup, createDraftRun } from "./deliveryRunService";
import { getEmergencyCancelRequest, recordPhysicalReturn, requestEmergencyCancel, reviewEmergencyCancelRequest } from "./emergencyCancelService";

/**
 * Real-MongoDB tests. Same known limitation as the other
 * *.integration.test.ts files: the mongodb-memory-server binary is not
 * downloadable in the sandbox, so these do not run here — run
 * `npm run test:integration` in dev/CI.
 *
 * Uses the REPLICA-SET test database (models/testDbReplSet.ts), not the
 * standalone one, because approval (`reviewEmergencyCancelRequest`) uses a
 * real multi-document MongoDB transaction — same reason activateRun's
 * integration tests use it (see deliveryRunService.integration.test.ts).
 *
 * `orderNumber` has a unique index in the real schema. Original test orders
 * here are numbered "orig-N" specifically so they can never collide with
 * the real, counter-generated Replacement Order numbers ("000001", "000002", ...).
 */
const address = { recipientName: "Ali", phone: "09120000000", province: "Zanjan", city: "Zanjan", addressLine: "Same St. 1", location: { lat: 36.68, lng: 48.5 } };

async function makeOrder(n: number) {
  return Order.create({
    orderNumber: `orig-${n}`,
    userId: new Types.ObjectId(),
    items: [{ productId: new Types.ObjectId(), productName: "سیب", unit: "kg", unitPrice: 1000, quantity: 2, lineTotal: 2000 }],
    deliveryAddress: address,
    subtotalAmount: 2000,
    totalAmount: 2000,
  });
}

describe("Emergency Cancel (integration, replica set)", () => {
  let admin: AuthContext;
  let courier: AuthContext;

  beforeAll(async () => {
    await startTestReplSetDb();
    await DeliveryRun.init();
    await DeliveryRunEmergencyCancelRequest.init();
  }, 180_000);
  afterAll(stopTestReplSetDb);
  afterEach(clearTestReplSetDb);

  async function seedActiveRunWithPickup(orderCount: number) {
    const adminDoc = await User.create({ phone: "09120000001", role: "admin" });
    const courierDoc = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "motorcycle" } });
    admin = { userId: adminDoc._id.toString(), role: "admin" };
    courier = { userId: courierDoc._id.toString(), role: "courier" };
    const orders = await Promise.all(Array.from({ length: orderCount }, (_, i) => makeOrder(i + 1)));
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: orders.map((o) => o._id.toString()) });
    const active = await activateRun(admin, draft.id);
    await confirmPickup(courier, active.id);
    return { orders, run: active };
  }

  it("full happy path: request -> approve -> run cancelled, order emergency_cancelled, replacement created with full items and new number", async () => {
    const { orders, run } = await seedActiveRunWithPickup(1);
    const original = orders[0]!;

    const request = await requestEmergencyCancel(courier, run.id, "پیک تصادف کرد و کالا آسیب دید");
    expect(request.status).toBe("pending");

    const reviewed = await reviewEmergencyCancelRequest(admin, request.id, "approve");
    expect(reviewed.status).toBe("approved");
    expect(reviewed.replacementOrderIds).toHaveLength(1);

    expect((await DeliveryRun.findById(run.id))?.status).toBe("cancelled");

    const originalAfter = await Order.findById(original._id);
    expect(originalAfter?.delivery.status).toBe("emergency_cancelled");
    expect(originalAfter?.delivery.emergencyCancelledAt).toBeInstanceOf(Date);
    expect(originalAfter?.status).toBe("preparing"); // Decision 3: Order.status untouched

    const replacement = await Order.findById(reviewed.replacementOrderIds[0]);
    expect(replacement).not.toBeNull();
    expect(replacement?.replacesOrderId?.toString()).toBe(original._id.toString());
    expect(replacement?.orderNumber).not.toBe(original.orderNumber);
    expect(replacement?.items).toHaveLength(original.items.length);
    expect(replacement?.items[0]?.quantity).toBe(original.items[0]!.quantity); // full quantity, no partial replacement
    expect(replacement?.totalAmount).toBe(original.totalAmount);
    expect(replacement?.deliveryAddress.addressLine).toBe(original.deliveryAddress.addressLine);
    expect(replacement?.userId.toString()).toBe(original.userId.toString());
    expect(replacement?.delivery.status).toBe("unassigned");
    expect(replacement?.status).toBe("preparing"); // normal default, Emergency Cancel invents no transition for it
    expect(replacement?.isPaid).toBe(false); // no new payment obligation created

    const audits = await AuditLog.find({ entityId: { $in: [request.id, replacement!._id] } }).lean();
    expect(audits.some((a) => a.action === "deliveryRun.emergency_cancel_requested")).toBe(true);
    expect(audits.some((a) => a.action === "deliveryRun.emergency_cancel_approved")).toBe(true);
    expect(audits.some((a) => a.action === "order.created_as_replacement")).toBe(true);
  });

  it("rejection leaves everything unchanged and allows a later new request", async () => {
    const { run } = await seedActiveRunWithPickup(1);
    const request = await requestEmergencyCancel(courier, run.id, "دلیل اول");
    const rejected = await reviewEmergencyCancelRequest(admin, request.id, "reject", "مشکل برطرف شد");
    expect(rejected.status).toBe("rejected");
    expect((await DeliveryRun.findById(run.id))?.status).toBe("active");

    const second = await requestEmergencyCancel(courier, run.id, "دلیل دوم");
    expect(second.status).toBe("pending");
    expect(second.id).not.toBe(request.id);
  });

  it("a second concurrent pending request for the same run is rejected (partial unique index)", async () => {
    const { run } = await seedActiveRunWithPickup(1);
    await requestEmergencyCancel(courier, run.id, "اول");
    await expect(requestEmergencyCancel(courier, run.id, "دوم")).rejects.toMatchObject({ code: "EMERGENCY_CANCEL_REQUEST_ALREADY_PENDING" });
  });

  it("mixed run: one picked_up order gets a replacement, one still-assigned order is released to unassigned, no replacement for it", async () => {
    const adminDoc = await User.create({ phone: "09120000001", role: "admin" });
    const courierDoc = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "car" } });
    admin = { userId: adminDoc._id.toString(), role: "admin" };
    courier = { userId: courierDoc._id.toString(), role: "courier" };
    const [pickedUpOrder, assignedOrder] = await Promise.all([makeOrder(1), makeOrder(2)]);
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [pickedUpOrder._id.toString(), assignedOrder._id.toString()] });
    const run = await activateRun(admin, draft.id);
    // Only the first stop's order is confirmed picked up (confirmPickup moves ALL pending
    // stops, so to leave one "assigned", cancel is not an option here — instead approve
    // Emergency Cancel while both are technically "assigned" is not the scenario we want;
    // simulate partial pickup by moving only one order's delivery status directly).
    await Order.updateOne({ _id: pickedUpOrder._id }, { $set: { "delivery.status": "picked_up", "delivery.pickedUpAt": new Date() } });

    const request = await requestEmergencyCancel(courier, run.id, "دلیل");
    const reviewed = await reviewEmergencyCancelRequest(admin, request.id, "approve");
    expect(reviewed.replacementOrderIds).toHaveLength(1);

    expect((await Order.findById(pickedUpOrder._id))?.delivery.status).toBe("emergency_cancelled");
    const released = await Order.findById(assignedOrder._id);
    expect(released?.delivery.status).toBe("unassigned");
    expect(released?.delivery.courierId).toBeUndefined();
  });

  it("physical return recording does not reopen the run or touch Order.status, and only works after approval", async () => {
    const { run } = await seedActiveRunWithPickup(1);
    const request = await requestEmergencyCancel(courier, run.id, "دلیل");

    await expect(recordPhysicalReturn(admin, request.id, true)).rejects.toMatchObject({ code: "EMERGENCY_CANCEL_NOT_APPROVED" });

    const reviewed = await reviewEmergencyCancelRequest(admin, request.id, "approve");
    const recorded = await recordPhysicalReturn(admin, reviewed.id, false);
    expect(recorded.physicalReturn).toMatchObject({ returned: false });
    expect((await DeliveryRun.findById(run.id))?.status).toBe("cancelled"); // still cancelled, not reopened
  });

  it("ordinary cancelRun still refuses once pickup has happened — Emergency Cancel is the only recovery path", async () => {
    const { run } = await seedActiveRunWithPickup(1);
    await expect(cancelRun(admin, run.id)).rejects.toMatchObject({ code: "RUN_HAS_PICKED_UP_ORDERS" });
  });

  it("a courier cannot read or act on another courier's request", async () => {
    const { run } = await seedActiveRunWithPickup(1);
    const request = await requestEmergencyCancel(courier, run.id, "دلیل");
    const otherCourierDoc = await User.create({ phone: "09120000003", role: "courier", courierProfile: { vehicleType: "bicycle" } });
    const otherCourier: AuthContext = { userId: otherCourierDoc._id.toString(), role: "courier" };
    await expect(getEmergencyCancelRequest(otherCourier, request.id)).rejects.toMatchObject({ code: "EMERGENCY_CANCEL_REQUEST_NOT_FOUND" });
  });

  it("re-approving an already-approved request is a no-op — no second Replacement Order", async () => {
    const { run } = await seedActiveRunWithPickup(1);
    const request = await requestEmergencyCancel(courier, run.id, "دلیل");
    const first = await reviewEmergencyCancelRequest(admin, request.id, "approve");
    const second = await reviewEmergencyCancelRequest(admin, request.id, "approve");
    expect(second.replacementOrderIds).toEqual(first.replacementOrderIds);
    const replacements = await Order.countDocuments({ replacesOrderId: { $exists: true } });
    expect(replacements).toBe(1);
  });
});
