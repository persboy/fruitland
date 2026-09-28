import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { DeliveryRun } from "../models/DeliveryRun";
import { Order } from "../models/Order";
import { User } from "../models/User";
import type { AuthContext } from "../auth/guard";
import { activateRun, cancelRun, confirmPickup, createDraftRun, proposeStopOutcome, reorderStops } from "./deliveryRunService";

/**
 * Real-MongoDB tests (uniqueness/partial-index behaviour is a database
 * guarantee and cannot be proven with mocks). Same known limitation as the
 * other *.integration.test.ts files: the mongodb-memory-server binary is not
 * downloadable in the sandbox, so run `npm run test:integration` in dev/CI.
 */
const address = { recipientName: "Ali", phone: "09120000000", province: "Zanjan", city: "Zanjan", addressLine: "Same St. 1", location: { lat: 36.68, lng: 48.5 } };

async function makeOrder(n: number) {
  return Order.create({
    orderNumber: String(n).padStart(6, "0"),
    userId: new Types.ObjectId(),
    items: [{ productId: new Types.ObjectId(), productName: "سیب", unit: "kg", unitPrice: 1000, quantity: 1, lineTotal: 1000 }],
    deliveryAddress: address,
    subtotalAmount: 1000,
    totalAmount: 1000,
  });
}

describe("DeliveryRun (integration)", () => {
  let admin: AuthContext;
  let courier: AuthContext;
  let courierDoc: InstanceType<typeof User>;

  beforeAll(async () => {
    await startTestDb();
    await DeliveryRun.init();
  }, 120_000);
  afterAll(stopTestDb);
  afterEach(clearTestDb);

  async function seedPeople() {
    const adminDoc = await User.create({ phone: "09120000001", role: "admin" });
    courierDoc = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "motorcycle" } });
    admin = { userId: adminDoc._id.toString(), role: "admin" };
    courier = { userId: courierDoc._id.toString(), role: "courier" };
  }

  it("keeps two orders at the same address as two stops and assigns both", async () => {
    await seedPeople();
    const [a, b] = [await makeOrder(1), await makeOrder(2)];
    const run = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString(), b._id.toString()] });
    expect(run.stops).toHaveLength(2);
    expect((await Order.findById(a._id))?.delivery.status).toBe("assigned");
    expect((await Order.findById(a._id))?.status).toBe("preparing");
  });

  it("refuses to put an order into a second open run, but allows it again after cancellation", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const first = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    await expect(createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] })).rejects.toMatchObject({ code: expect.stringMatching(/ORDER_ALREADY_IN_RUN|ORDER_NOT_ASSIGNABLE/) });
    await cancelRun(admin, first.id);
    expect((await Order.findById(order._id))?.delivery.status).toBe("unassigned");
    await expect(createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] })).resolves.toBeDefined();
  });

  it("the partial unique index rejects the same order in two open runs at the database level", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const base = { courierId: courierDoc._id, createdByAdminUserId: new Types.ObjectId(), stops: [{ orderId: order._id, sequence: 1 }] };
    await DeliveryRun.create(base);
    await expect(DeliveryRun.create(base)).rejects.toMatchObject({ code: 11000 });
    await DeliveryRun.create({ ...base, status: "cancelled" }); // history keeps its order references
  });

  it("full flow: activate → pickup → reorder → propose; the order is proposed, never resolved", async () => {
    await seedPeople();
    const [a, b, c] = [await makeOrder(1), await makeOrder(2), await makeOrder(3)];
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a, b, c].map((o) => o._id.toString()) });
    await activateRun(admin, draft.id);
    await confirmPickup(courier, draft.id);

    const ids = draft.stops.map((s) => s.id);
    const reordered = await reorderStops(courier, draft.id, [ids[2]!, ids[0]!, ids[1]!]);
    expect(reordered.stops.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);

    await proposeStopOutcome(courier, draft.id, ids[2]!, "delivered");
    const proposed = await Order.findById(c._id);
    expect(proposed?.delivery.status).toBe("proposed");
    expect(proposed?.delivery.proposedOutcome).toBe("delivered");

    // a resolved stop can no longer be reordered
    await expect(reorderStops(courier, draft.id, [ids[2]!, ids[0]!, ids[1]!])).rejects.toMatchObject({ code: "REORDER_NOT_PENDING" });

    await proposeStopOutcome(courier, draft.id, ids[0]!, "failed");
    await proposeStopOutcome(courier, draft.id, ids[1]!, "delivered");
    expect((await DeliveryRun.findById(draft.id))?.status).toBe("completed");
  });

  it("another courier cannot reorder or read this run", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const run = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    await activateRun(admin, run.id);
    const other = await User.create({ phone: "09120000003", role: "courier", courierProfile: { vehicleType: "car" } });
    await expect(reorderStops({ userId: other._id.toString(), role: "courier" }, run.id, [run.stops[0]!.id])).rejects.toMatchObject({ code: "DELIVERY_RUN_NOT_FOUND" });
  });
});
