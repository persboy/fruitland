import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orderFind: vi.fn(), orderCount: vi.fn(), orderFindById: vi.fn(), orderFindOneAndUpdate: vi.fn(),
  userFind: vi.fn(), auditCreate: vi.fn(),
}));
vi.mock("../models/Order", () => ({
  Order: { find: m.orderFind, countDocuments: m.orderCount, findById: m.orderFindById, findOneAndUpdate: m.orderFindOneAndUpdate },
}));
vi.mock("../models/User", () => ({ User: { find: m.userFind } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { cancelOrder, getOrder, listOrders } from "./orderService";

const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const chain = (docs: unknown[]) => {
  const c = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), lean: () => Promise.resolve(docs) };
  c.sort.mockReturnValue(c); c.skip.mockReturnValue(c); c.limit.mockReturnValue(c);
  return c;
};
const T0 = new Date("2026-01-01T10:00:00Z");
const actor = new Types.ObjectId().toString();
const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, ...over });
const userId = new Types.ObjectId();
const courierId = new Types.ObjectId();
const listOrder = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), orderNumber: "000001", userId, status: "preparing", source: "online", delivery: { status: "unassigned" },
  deliveryAddress: { recipientName: "گیرنده" }, items: [{ _id: new Types.ObjectId() }, { _id: new Types.ObjectId() }], totalAmount: 130000, createdAt: T0, ...over,
});
const detailOrder = (over: Record<string, unknown> = {}) => ({
  ...listOrder(), updatedAt: T0, paymentMethod: "cod", isPaid: false, subtotalAmount: 120000, discountAmount: 0, deliveryFeeAmount: 10000,
  deliveryAddress: { recipientName: "گیرنده", phone: "09121110000", province: "زنجان", city: "زنجان", addressLine: "خیابان ۱", location: { lat: 1, lng: 2 } },
  items: [{ _id: new Types.ObjectId(), productName: "سیب", unit: "kg", unitPrice: 60000, quantity: 2, lineTotal: 120000 }],
  ...over,
});
const expectApp = (p: Promise<unknown>, code: string, status: number) => expect(p).rejects.toMatchObject({ name: "AppError", code, status });

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("listOrders", () => {
  function arrange(docs: unknown[], total = docs.length) {
    const c = chain(docs);
    m.orderFind.mockReturnValue(c);
    m.orderCount.mockResolvedValue(total);
    m.userFind.mockReturnValue(chain([{ _id: userId, firstName: "علی", lastName: "رضایی", phone: "09120000001" }]));
    return c;
  }

  it("newest first, paginated, and the DTO has only the approved list fields", async () => {
    const c = arrange([listOrder()], 45);
    const out = await listOrders(q({ page: 3, limit: 10 }));
    expect(c.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(c.skip).toHaveBeenCalledWith(20);
    expect(c.limit).toHaveBeenCalledWith(10);
    expect(out.pagination).toEqual({ page: 3, pageSize: 10, total: 45 });
    expect(Object.keys(out.items[0]!).sort()).toEqual(
      ["createdAt", "customerName", "customerPhone", "deliveryStatus", "id", "isReplacement", "itemCount", "orderNumber", "recipientName", "source", "status", "totalAmount"],
    );
    expect(out.items[0]).toMatchObject({ customerName: "علی رضایی", customerPhone: "09120000001", itemCount: 2, isReplacement: false });
  });

  it("uses an explicit projection (no items snapshot, address, notes, payment, courier data)", async () => {
    arrange([]);
    await listOrders(q());
    const projection = Object.keys(m.orderFind.mock.calls[0]![1] as object);
    expect(projection).toContain("items._id");
    expect(projection.join()).not.toMatch(/productName|deliveryAddress\.(phone|addressLine)|customerNote|isPaid|courier/);
  });

  it("filters map to the real fields and are ANDed", async () => {
    arrange([]);
    await listOrders(q({ status: "shipped", deliveryStatus: "picked_up", source: "phone" }));
    expect(m.orderFind.mock.calls[0]![0]).toEqual({ status: "shipped", "delivery.status": "picked_up", source: "phone" });
    expect(m.userFind).not.toHaveBeenCalled(); // no search → no user lookup
  });

  it("digit search = anchored order-number prefix OR the ordering customers (bounded to 50, escaped)", async () => {
    arrange([]);
    m.userFind.mockReturnValue({ limit: vi.fn().mockReturnValue(lean([{ _id: userId }])) });
    await listOrders(q({ search: "0912" }));
    const filter = m.orderFind.mock.calls[0]![0] as { $or: Record<string, unknown>[] };
    expect((filter.$or[0]!.orderNumber as RegExp).source).toBe("^0912");
    expect(filter.$or[1]).toEqual({ userId: { $in: [userId] } });
    const limitFn = m.userFind.mock.results[0]!.value.limit as ReturnType<typeof vi.fn>;
    expect(limitFn).toHaveBeenCalledWith(50);
  });

  it("name search skips the order-number branch, never builds an unescaped regex, and finds nothing → impossible filter", async () => {
    arrange([]);
    m.userFind.mockReturnValue({ limit: () => lean([]) });
    await listOrders(q({ search: ".*" }));
    expect(m.orderFind.mock.calls[0]![0]).toEqual({ _id: { $in: [] } });
    const userFilter = m.userFind.mock.calls[0]![0] as { $and: { $or: { [k: string]: RegExp }[] }[] };
    expect(userFilter.$and[0]!.$or[1]!.firstName!.test("abc")).toBe(false); // ".*" is literal
  });

  it("caps search tokens at 3", async () => {
    arrange([]);
    m.userFind.mockReturnValue({ limit: () => lean([]) });
    await listOrders(q({ search: "a b c d e" }));
    expect((m.userFind.mock.calls[0]![0] as { $and: unknown[] }).$and).toHaveLength(3);
  });

  it("flags replacement orders and tolerates a missing customer account", async () => {
    arrange([listOrder({ replacesOrderId: new Types.ObjectId(), userId: new Types.ObjectId() })]);
    const out = await listOrders(q());
    expect(out.items[0]).toMatchObject({ isReplacement: true, customerName: null, customerPhone: null });
  });
});

describe("getOrder", () => {
  it("malformed id → 404 without a query", async () => {
    await expectApp(getOrder("zzz"), "ORDER_NOT_FOUND", 404);
    expect(m.orderFindById).not.toHaveBeenCalled();
  });

  it("missing → 404", async () => {
    m.orderFindById.mockReturnValue(lean(null));
    await expectApp(getOrder(new Types.ObjectId().toString()), "ORDER_NOT_FOUND", 404);
  });

  it("builds the DTO from the STORED snapshots; the courier is name+phone only; no location of any kind", async () => {
    const replacesOrderId = new Types.ObjectId();
    const o = detailOrder({
      delivery: { status: "assigned", courierId, assignedAt: T0 },
      replacesOrderId,
    });
    m.orderFindById.mockReturnValueOnce(lean(o)).mockReturnValueOnce(lean({ _id: replacesOrderId, orderNumber: "000000" }));
    m.orderFind.mockReturnValue({ sort: () => lean([{ _id: new Types.ObjectId(), orderNumber: "000009" }]) });
    m.userFind.mockReturnValue(lean([
      { _id: userId, firstName: "علی", lastName: "رضایی", phone: "09120000001", addresses: [{ addressLine: "NEW ADDRESS" }], courierProfile: { currentLocation: { lat: 9, lng: 9 } } },
      { _id: courierId, firstName: "پیک", lastName: "یک", phone: "09120000002", courierProfile: { currentLocation: { lat: 9, lng: 9 } } },
    ]));
    const dto = await getOrder(o._id.toString());
    expect(dto.items[0]).toMatchObject({ productName: "سیب", unitPrice: 60000, quantity: 2, lineTotal: 120000 });
    expect(dto.deliveryAddress).toEqual({ recipientName: "گیرنده", phone: "09121110000", province: "زنجان", city: "زنجان", addressLine: "خیابان ۱", postalCode: null });
    expect(dto.delivery.courier).toMatchObject({ name: "پیک یک", phone: "09120000002" });
    expect(dto.replacesOrder).toMatchObject({ orderNumber: "000000" });
    expect(dto.replacedBy).toMatchObject([{ orderNumber: "000009" }]);
    expect(dto).toMatchObject({ paymentMethod: "cod", isPaid: false, paidAt: null, cancellation: null });
    const json = JSON.stringify(dto);
    expect(json).not.toMatch(/currentLocation|NEW ADDRESS|"lat"|"lng"|courierProfile|addresses/);
    expect(m.userFind.mock.calls[0]![1]).toEqual({ firstName: 1, lastName: 1, phone: 1 });
  });

  it("includes cancellation data when present", async () => {
    const o = detailOrder({ status: "cancelled", cancelReason: "منصرف شد", canceledAt: T0, canceledByUserId: new Types.ObjectId() });
    m.orderFindById.mockReturnValue(lean(o));
    m.orderFind.mockReturnValue({ sort: () => lean([]) });
    m.userFind.mockReturnValue(lean([]));
    const dto = await getOrder(o._id.toString());
    expect(dto.cancellation).toMatchObject({ reason: "منصرف شد", canceledAt: T0.toISOString() });
    expect(dto.customer).toBeNull();
  });
});

describe("cancelOrder", () => {
  const id = new Types.ObjectId();

  it("ONE conditional write pinned to preparing + unassigned; records reason/time/actor; audits once", async () => {
    m.orderFindOneAndUpdate.mockReturnValue(lean({ status: "preparing" }));
    const o = detailOrder({ _id: id, status: "cancelled", cancelReason: "r" });
    m.orderFindById.mockReturnValue(lean(o));
    m.orderFind.mockReturnValue({ sort: () => lean([]) });
    m.userFind.mockReturnValue(lean([]));
    await cancelOrder(actor, id.toString(), "r");
    const [filter, update, options] = m.orderFindOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: id, status: "preparing", "delivery.status": "unassigned" });
    expect(Object.keys(update.$set).sort()).toEqual(["canceledAt", "canceledByUserId", "cancelReason", "status"].sort());
    expect(update.$set).toMatchObject({ status: "cancelled", cancelReason: "r" });
    expect(update.$set.canceledByUserId.toString()).toBe(actor);
    expect(options).toMatchObject({ new: false, runValidators: true });
    // never touches payment / delivery / discount fields
    expect(JSON.stringify(update)).not.toMatch(/isPaid|paidAt|delivery|usedCount/);
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "order.cancelled", entityType: "Order", entityId: id, before: { status: "preparing" }, after: { status: "cancelled", cancelReason: "r" } });
  });

  it.each([
    ["already cancelled", { status: "cancelled", delivery: { status: "unassigned" } }, "ORDER_ALREADY_CANCELLED"],
    ["shipped", { status: "shipped", delivery: { status: "picked_up" } }, "ORDER_NOT_CANCELLABLE"],
    ["delivered", { status: "delivered", delivery: { status: "resolved" } }, "ORDER_NOT_CANCELLABLE"],
    ["returned", { status: "returned", delivery: { status: "resolved" } }, "ORDER_NOT_CANCELLABLE"],
    ["preparing but assigned to a run", { status: "preparing", delivery: { status: "assigned" } }, "ORDER_IN_DELIVERY"],
    ["preparing but emergency-cancelled", { status: "preparing", delivery: { status: "emergency_cancelled" } }, "ORDER_IN_DELIVERY"],
  ])("rejects %s with 409 %s: nothing written, no audit", async (_n, fresh, code) => {
    m.orderFindOneAndUpdate.mockReturnValue(lean(null));
    m.orderFindById.mockReturnValue(lean(fresh));
    await expectApp(cancelOrder(actor, id.toString(), "r"), code, 409);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("missing order → 404; malformed id → 404 without a write", async () => {
    m.orderFindOneAndUpdate.mockReturnValue(lean(null));
    m.orderFindById.mockReturnValue(lean(null));
    await expectApp(cancelOrder(actor, id.toString(), "r"), "ORDER_NOT_FOUND", 404);
    m.orderFindOneAndUpdate.mockClear();
    await expectApp(cancelOrder(actor, "zzz", "r"), "ORDER_NOT_FOUND", 404);
    expect(m.orderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("race: the order was assigned between the admin's page load and the write → the conditional write matches nothing → 409 ORDER_IN_DELIVERY (the cancel loses cleanly)", async () => {
    m.orderFindOneAndUpdate.mockReturnValue(lean(null));
    m.orderFindById.mockReturnValue(lean({ status: "preparing", delivery: { status: "assigned" } }));
    await expectApp(cancelOrder(actor, id.toString(), "r"), "ORDER_IN_DELIVERY", 409);
  });
});
