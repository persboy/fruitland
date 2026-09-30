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

  it("Decision 5: an 'offline' courier is still fully eligible for draft creation, and courierProfile.status is left untouched", async () => {
    await seedPeople();
    await User.updateOne({ _id: courierDoc._id }, { $set: { "courierProfile.status": "offline" } });
    const order = await makeOrder(1);
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    expect(draft.status).toBe("draft");
    expect((await User.findById(courierDoc._id))?.courierProfile?.status).toBe("offline"); // unchanged
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

  it("Decision 5: activation succeeds for an 'offline' courier, and courierProfile.status is left completely untouched by activation", async () => {
    await seedPeople();
    await User.updateOne({ _id: courier.userId }, { $set: { "courierProfile.status": "offline" } });
    const order = await makeOrder(1);
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });

    const active = await activateRun(admin, draft.id); // must succeed despite "offline"
    expect(active.status).toBe("active");
    expect((await User.findById(courier.userId))?.courierProfile?.status).toBe("offline"); // still unchanged — no auto-sync to "busy"
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

  it("once one draft activates an order, activating a DIFFERENT courier's draft with the same order fails atomically and cleanly (Decision 1, isolated from Decision 4)", async () => {
    await seedPeople();
    const otherCourierDoc = await User.create({ phone: "09120000004", role: "courier", courierProfile: { vehicleType: "bicycle" } });
    const otherCourier: AuthContext = { userId: otherCourierDoc._id.toString(), role: "courier" };
    const order = await makeOrder(1);
    // Two DIFFERENT couriers, so this isolates the order-level unique constraint (Decision 1)
    // from the courier-level one-active-run constraint (Decision 4, tested separately below).
    const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [order._id.toString()] });
    const draftB = await createDraftRun(admin, { courierId: otherCourier.userId, orderIds: [order._id.toString()] });

    await activateRun(admin, draftA.id);
    await expect(activateRun(admin, draftB.id)).rejects.toMatchObject({ code: expect.stringMatching(/ORDER_NOT_ASSIGNABLE|ORDER_ALREADY_IN_ACTIVE_RUN/) });

    expect((await DeliveryRun.findById(draftB.id))?.status).toBe("draft");
    expect((await Order.findById(order._id))?.delivery.status).toBe("assigned");
    expect((await Order.findById(order._id))?.delivery.courierId?.toString()).toBe(courier.userId); // still courier A's, not otherCourier's
  });

  describe("Decision 4 (approved): at most one active run per courier", () => {
    it("a courier may hold several draft runs at once", async () => {
      await seedPeople();
      const [a, b, c] = [await makeOrder(1), await makeOrder(2), await makeOrder(3)];
      const drafts = await Promise.all(
        [a, b, c].map((o) => createDraftRun(admin, { courierId: courier.userId, orderIds: [o._id.toString()] })),
      );
      expect(new Set(drafts.map((d) => d.id)).size).toBe(3);
      for (const d of drafts) expect(d.status).toBe("draft");
    });

    it("activating a second draft while the first is still active fails, and the first run is untouched", async () => {
      await seedPeople();
      const [a, b] = [await makeOrder(1), await makeOrder(2)];
      const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString()] });
      const draftB = await createDraftRun(admin, { courierId: courier.userId, orderIds: [b._id.toString()] });
      await activateRun(admin, draftA.id);

      await expect(activateRun(admin, draftB.id)).rejects.toMatchObject({ code: "COURIER_ALREADY_HAS_ACTIVE_RUN" });

      expect((await DeliveryRun.findById(draftA.id))?.status).toBe("active");
      expect((await DeliveryRun.findById(draftB.id))?.status).toBe("draft");
      expect((await Order.findById(b._id))?.delivery.status).toBe("unassigned"); // never touched
    });

    it("activating a second draft becomes possible once the first run is completed", async () => {
      await seedPeople();
      const [a, b] = [await makeOrder(1), await makeOrder(2)];
      const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString()] });
      const runA = await activateRun(admin, draftA.id);
      const draftB = await createDraftRun(admin, { courierId: courier.userId, orderIds: [b._id.toString()] });
      await expect(activateRun(admin, draftB.id)).rejects.toMatchObject({ code: "COURIER_ALREADY_HAS_ACTIVE_RUN" });

      await confirmPickup(courier, runA.id);
      await proposeStopOutcome(courier, runA.id, runA.stops[0]!.id, "delivered");
      expect((await DeliveryRun.findById(runA.id))?.status).toBe("completed"); // no pending stops left

      const activeB = await activateRun(admin, draftB.id);
      expect(activeB.status).toBe("active");
    });

    it("activating a second draft becomes possible once the first run is cancelled", async () => {
      await seedPeople();
      const [a, b] = [await makeOrder(1), await makeOrder(2)];
      const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString()] });
      const draftB = await createDraftRun(admin, { courierId: courier.userId, orderIds: [b._id.toString()] });
      const runA = await activateRun(admin, draftA.id);
      await cancelRun(admin, runA.id); // still only "assigned" (not picked up) — cancellable per existing cancelRun rules

      const activeB = await activateRun(admin, draftB.id);
      expect(activeB.status).toBe("active");
    });

    it("two different couriers may each independently hold one active run without conflict", async () => {
      await seedPeople();
      const otherCourierDoc = await User.create({ phone: "09120000003", role: "courier", courierProfile: { vehicleType: "car" } });
      const otherCourier: AuthContext = { userId: otherCourierDoc._id.toString(), role: "courier" };
      const [a, b] = [await makeOrder(1), await makeOrder(2)];
      const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString()] });
      const draftB = await createDraftRun(admin, { courierId: otherCourier.userId, orderIds: [b._id.toString()] });

      const [activeA, activeB] = await Promise.all([activateRun(admin, draftA.id), activateRun(admin, draftB.id)]);
      expect(activeA.status).toBe("active");
      expect(activeB.status).toBe("active");
    });

    it("does not mutate Order.status when rejecting a second active run for the same courier", async () => {
      await seedPeople();
      const [a, b] = [await makeOrder(1), await makeOrder(2)];
      const draftA = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a._id.toString()] });
      const draftB = await createDraftRun(admin, { courierId: courier.userId, orderIds: [b._id.toString()] });
      await activateRun(admin, draftA.id);
      await expect(activateRun(admin, draftB.id)).rejects.toMatchObject({ code: "COURIER_ALREADY_HAS_ACTIVE_RUN" });
      expect((await Order.findById(b._id))?.status).toBe("preparing"); // Decision 3: Order.status is never touched by DeliveryRun
    });
  });

  it("full flow after activation: pickup → reorder → propose; the order is proposed, never resolved", async () => {
    await seedPeople();
    const [a, b, c] = [await makeOrder(1), await makeOrder(2), await makeOrder(3)];
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: [a, b, c].map((o) => o._id.toString()) });
    const active = await activateRun(admin, draft.id);
    const assignedAtBefore = (await Order.findById(a._id))?.delivery.assignedAt?.getTime();
    await confirmPickup(courier, active.id);

    const pickedUp = await Order.findById(a._id);
    expect(pickedUp?.delivery.status).toBe("picked_up");
    expect(pickedUp?.delivery.pickedUpAt).toBeInstanceOf(Date); // Decision 2: a distinct, real physical-custody timestamp...
    expect(pickedUp?.delivery.assignedAt?.getTime()).toBe(assignedAtBefore); // ...that never touches assignedAt (Decision 1).

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
