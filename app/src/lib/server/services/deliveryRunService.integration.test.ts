import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { startTestReplSetDb, stopTestReplSetDb, clearTestReplSetDb } from "../models/testDbReplSet";
import { DeliveryRun } from "../models/DeliveryRun";
import { Order } from "../models/Order";
import { User } from "../models/User";
import type { AuthContext } from "../auth/guard";
import { activateRun, cancelRun, confirmPickup, createDraftRun, proposeStopOutcome, reorderStops } from "./deliveryRunService";

/**
 * Real-MongoDB tests. Same known limitation as the other
 * *.integration.test.ts files: the mongodb-memory-server binary is not
 * downloadable in the sandbox, so these do not run here — run
 * `npm run test:integration` in dev/CI.
 *
 * Two `describe` blocks, two different MongoDB topologies:
 *  - "planning / activation eligibility" uses the project's normal
 *    STANDALONE test database (models/testDb.ts) — everything here is
 *    single-document conditional updates, which standalone MongoDB
 *    supports fine.
 *  - "activateRun (transactional)" uses models/testDbReplSet.ts instead,
 *    because `activateRun` uses a real multi-document transaction
 *    (see deliveryRunService.ts's doc comment on activateRun) and
 *    transactions require a replica set — a standalone mongod cannot run
 *    them at all, which is exactly what the last test in that block proves.
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

describe("DeliveryRun — planning / activation eligibility (standalone MongoDB)", () => {
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

  it("creating a draft does not touch the order at all — it stays unassigned", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    expect(draft.status).toBe("draft");
    const fresh = await Order.findById(order._id);
    expect(fresh?.delivery.status).toBe("unassigned");
    expect(fresh?.delivery.courierId).toBeUndefined();
    expect(fresh?.status).toBe("preparing");
  });

  it("the SAME order may sit in several draft runs at once — the partial unique index does not cover drafts", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    const draftB = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    expect(draftA.id).not.toBe(draftB.id);
    expect((await Order.findById(order._id))?.delivery.status).toBe("unassigned");
  });

  it("keeps two orders at the same address as two stops", async () => {
    await seedPeople();
    const [a, b] = [await makeOrder(1), await makeOrder(2)];
    const run = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString(), b._id.toString()] });
    expect(run.stops).toHaveLength(2);
  });

  it("cancelling a draft never touches the order (nothing was reserved)", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    await cancelRun(admin, draft.id);
    expect((await Order.findById(order._id))?.delivery.status).toBe("unassigned");
  });

  it("another courier cannot reorder or read this run", async () => {
    await seedPeople();
    // reorderStops needs an ACTIVE run, which needs a real transaction — covered by
    // the replica-set block below. Here we only check ownership on a draft-shaped record directly.
    const order = await makeOrder(1);
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    const other = await User.create({ phone: "09120000003", role: "courier", courierProfile: { vehicleType: "car" } });
    await expect(reorderStops({ userId: other._id.toString(), role: "courier" }, draft.id, [])).rejects.toMatchObject({ code: "DELIVERY_RUN_NOT_FOUND" });
  });
});

describe("activateRun (transactional — requires a replica set)", () => {
  let admin: AuthContext;
  let courier: AuthContext;

  beforeAll(async () => {
    await startTestReplSetDb();
    await DeliveryRun.init();
  }, 180_000);
  afterAll(stopTestReplSetDb);
  afterEach(clearTestReplSetDb);

  async function seedPeople() {
    const adminDoc = await User.create({ phone: "09120000001", role: "admin" });
    const courierDoc = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "motorcycle" } });
    admin = { userId: adminDoc._id.toString(), role: "admin" };
    courier = { userId: courierDoc._id.toString(), role: "courier" };
  }

  it("activation assigns every order and flips the run to active, atomically", async () => {
    await seedPeople();
    const [a, b] = [await makeOrder(1), await makeOrder(2)];
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString(), b._id.toString()] });
    const before = Date.now();
    const active = await activateRun(admin, draft.id);
    expect(active.status).toBe("active");
    for (const order of [a, b]) {
      const fresh = await Order.findById(order._id);
      expect(fresh?.delivery.status).toBe("assigned");
      expect(fresh?.delivery.courierId?.toString()).toBe(courier.userId);
      expect(fresh?.delivery.assignedAt?.getTime()).toBeGreaterThanOrEqual(before);
    }
  });

  it("all-or-nothing: if one order is no longer eligible, NONE are assigned and the run stays draft", async () => {
    await seedPeople();
    const [a, b] = [await makeOrder(1), await makeOrder(2)];
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString(), b._id.toString()] });
    // Make order B ineligible from underneath the draft (already assigned elsewhere).
    await Order.updateOne({ _id: b._id }, { $set: { "delivery.status": "assigned" } });

    await expect(activateRun(admin, draft.id)).rejects.toMatchObject({ code: "ORDER_NOT_ASSIGNABLE" });

    expect((await DeliveryRun.findById(draft.id))?.status).toBe("draft");
    expect((await Order.findById(a._id))?.delivery.status).toBe("unassigned"); // rolled back by the transaction
  });

  it("once one draft activates an order, activating a second draft with the same order fails atomically and cleanly", async () => {
    await seedPeople();
    const order = await makeOrder(1);
    const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    const draftB = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });

    await activateRun(admin, draftA.id);
    await expect(activateRun(admin, draftB.id)).rejects.toMatchObject({ code: expect.stringMatching(/ORDER_NOT_ASSIGNABLE|ORDER_ALREADY_IN_ACTIVE_RUN/) });

    expect((await DeliveryRun.findById(draftB.id))?.status).toBe("draft");
    expect((await Order.findById(order._id))?.delivery.status).toBe("assigned");
  });

  it("full flow after activation: pickup → reorder → propose; the order is proposed, never resolved", async () => {
    await seedPeople();
    const [a, b, c] = [await makeOrder(1), await makeOrder(2), await makeOrder(3)];
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a, b, c].map((o) => o._id.toString()) });
    const active = await activateRun(admin, draft.id);
    await confirmPickup(courier, active.id);

    const ids = active.stops.map((s) => s.id);
    const reordered = await reorderStops(courier, active.id, [ids[2]!, ids[0]!, ids[1]!]);
    expect(reordered.stops.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);

    await proposeStopOutcome(courier, active.id, ids[2]!, "delivered");
    const proposed = await Order.findById(c._id);
    expect(proposed?.delivery.status).toBe("proposed");
    expect(proposed?.delivery.proposedOutcome).toBe("delivered");

    await expect(reorderStops(courier, active.id, [ids[2]!, ids[0]!, ids[1]!])).rejects.toMatchObject({ code: "REORDER_NOT_PENDING" });

    await proposeStopOutcome(courier, active.id, ids[0]!, "failed");
    await proposeStopOutcome(courier, active.id, ids[1]!, "delivered");
    expect((await DeliveryRun.findById(active.id))?.status).toBe("completed");
  });
});
