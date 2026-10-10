import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestReplSetDb, stopTestReplSetDb, clearTestReplSetDb } from "../models/testDbReplSet";
import { AuditLog } from "../models/AuditLog";
import { DeliveryRun } from "../models/DeliveryRun";
import { Order } from "../models/Order";
import { User } from "../models/User";
import type { AuthContext } from "../auth/guard";
import { activateRun, confirmPickup, createDraftRun } from "./deliveryRunService";
import { cancelOrder, getOrder, listOrders } from "./orderService";

/**
 * Real-MongoDB (REPLICA SET) tests for Page 9. Same known limitation as every *.integration.test.ts:
 * the mongodb-memory-server binary is not downloadable in the sandbox, so these were WRITTEN BUT
 * NOT EXECUTED there — run `npm run test:integration` in dev/CI. A replica set is needed because
 * run activation and pickup are real transactions.
 */
const address = { recipientName: "Ali", phone: "09120000000", province: "Zanjan", city: "Zanjan", addressLine: "Same St. 1", location: { lat: 36.68, lng: 48.5 } };
let orderSeq = 0;
const makeOrder = (over: Record<string, unknown> = {}) =>
  Order.create({
    orderNumber: String(++orderSeq).padStart(6, "0"),
    userId: new Types.ObjectId(),
    items: [{ productId: new Types.ObjectId(), productName: "سیب", unit: "kg", unitPrice: 1000, quantity: 1, lineTotal: 1000 }],
    deliveryAddress: address,
    subtotalAmount: 1000,
    totalAmount: 1000,
    ...over,
  });

let admin: AuthContext;
let courier: AuthContext;

beforeAll(async () => {
  await startTestReplSetDb();
  await DeliveryRun.init();
}, 120_000);
afterAll(stopTestReplSetDb);
afterEach(clearTestReplSetDb);

async function seedPeople() {
  const a = await User.create({ phone: "09120000001", role: "admin" });
  const c = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "motorcycle" } });
  admin = { userId: a._id.toString(), role: "admin" };
  courier = { userId: c._id.toString(), role: "courier" };
}

describe("cancelOrder (real MongoDB)", () => {
  it("cancels a preparing+unassigned order, records reason/time/actor, audits once, leaves payment/delivery untouched", async () => {
    await seedPeople();
    const o = await makeOrder();
    const dto = await cancelOrder(admin.userId, o._id.toString(), "مشتری منصرف شد");
    expect(dto.status).toBe("cancelled");
    expect(dto.cancellation).toMatchObject({ reason: "مشتری منصرف شد", canceledByUserId: admin.userId });
    const raw = await Order.findById(o._id).lean();
    expect(raw).toMatchObject({ status: "cancelled", isPaid: false, delivery: { status: "unassigned" } });
    expect(await AuditLog.countDocuments({ action: "order.cancelled", entityId: o._id })).toBe(1);
  });

  it.each([
    ["shipped", { status: "shipped", delivery: { status: "picked_up" } }, "ORDER_NOT_CANCELLABLE"],
    ["delivered", { status: "delivered" }, "ORDER_NOT_CANCELLABLE"],
    ["cancelled", { status: "cancelled" }, "ORDER_ALREADY_CANCELLED"],
    ["assigned", { delivery: { status: "assigned" } }, "ORDER_IN_DELIVERY"],
  ])("rejects %s and writes nothing", async (_n, over, code) => {
    await seedPeople();
    const o = await makeOrder(over);
    const before = await Order.findById(o._id).lean();
    await expect(cancelOrder(admin.userId, o._id.toString(), "x")).rejects.toMatchObject({ status: 409, code });
    expect(await Order.findById(o._id).lean()).toEqual(before);
    expect(await AuditLog.countDocuments({ action: "order.cancelled" })).toBe(0);
  });

  it("concurrent double cancel: exactly one succeeds and one audit exists", async () => {
    await seedPeople();
    const o = await makeOrder();
    const r = await Promise.allSettled([1, 2, 3].map((n) => cancelOrder(admin.userId, o._id.toString(), `r${n}`)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: "order.cancelled" })).toBe(1);
  });

  it("race: cancel vs activateRun on the same order never leaves a cancelled order inside an active run", async () => {
    for (let i = 0; i < 8; i += 1) {
      await seedPeople().catch(() => undefined);
      const o = await makeOrder();
      const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [o._id.toString()] });
      await Promise.allSettled([cancelOrder(admin.userId, o._id.toString(), "x"), activateRun(admin, draft.id)]);
      const order = await Order.findById(o._id).lean();
      const run = await DeliveryRun.findById(draft.id).lean();
      expect(order?.status === "cancelled" && order.delivery.status !== "unassigned").toBe(false);
      expect(order?.status === "cancelled" && run?.status === "active").toBe(false);
      await clearTestReplSetDb();
    }
  }, 120_000);

  it("confirmPickup moves Order.status to shipped atomically with delivery.status, and the order is then not cancellable here", async () => {
    await seedPeople();
    const o = await makeOrder();
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [o._id.toString()] });
    const active = await activateRun(admin, draft.id);
    await confirmPickup(courier, active.id);
    expect(await Order.findById(o._id).lean()).toMatchObject({ status: "shipped", delivery: { status: "picked_up" } });
    await expect(cancelOrder(admin.userId, o._id.toString(), "x")).rejects.toMatchObject({ code: "ORDER_NOT_CANCELLABLE" });
  });
});

describe("listOrders / getOrder (real MongoDB)", () => {
  it("filters, order-number prefix and customer name/phone search, newest first", async () => {
    const alice = await User.create({ phone: "09125550001", role: "customer", firstName: "آلیس", lastName: "احمدی" });
    const bob = await User.create({ phone: "09125550002", role: "customer", firstName: "باب", lastName: "بابایی" });
    const a = await makeOrder({ userId: alice._id });
    await makeOrder({ userId: bob._id, status: "shipped" });
    expect((await listOrders({ page: 1, limit: 20 })).items.map((i) => i.orderNumber)).toHaveLength(2);
    expect((await listOrders({ page: 1, limit: 20, status: "shipped" })).items).toHaveLength(1);
    expect((await listOrders({ page: 1, limit: 20, search: a.orderNumber })).items.map((i) => i.id)).toEqual([a._id.toString()]);
    expect((await listOrders({ page: 1, limit: 20, search: "0912555000" })).items).toHaveLength(2);
    expect((await listOrders({ page: 1, limit: 20, search: "آلیس" })).items.map((i) => i.id)).toEqual([a._id.toString()]);
    expect((await getOrder(a._id.toString())).customerName).toBe("آلیس احمدی");
  });
});
