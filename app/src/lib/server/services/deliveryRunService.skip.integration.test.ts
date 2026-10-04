import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestReplSetDb, stopTestReplSetDb, clearTestReplSetDb } from "../models/testDbReplSet";
import { AuditLog } from "../models/AuditLog";
import { DeliveryRun } from "../models/DeliveryRun";
import { Order } from "../models/Order";
import { User } from "../models/User";
import type { AuthContext } from "../auth/guard";
import {
  activateRun,
  confirmPickup,
  createDraftRun,
  proposeStopOutcome,
  skipStop,
  type TransactionHooks,
} from "./deliveryRunService";

/**
 * Decision 7 — REAL MongoDB TRANSACTION tests (single-node replica set via
 * `MongoMemoryReplSet`). Standalone MongoDB cannot run these at all.
 *
 * Authoritative execution (dev/CI, with network access to
 * fastdl.mongodb.org or a local `mongod` configured as a replica set):
 *
 *   npm run test:integration --workspace=app -- src/lib/server/services/deliveryRunService.skip.integration.test.ts
 *
 * These tests are NOT executed in the sandbox that wrote them (binary
 * download blocked: `x-deny-reason: host_not_allowed`), so nothing here may
 * be reported as passed until it has run in a supported environment.
 *
 * Architecture note: stops are EMBEDDED in the DeliveryRun document, so a
 * stop write is a write to the shared run document. Two concurrent skips of
 * different stops of one run therefore conflict naturally on that document;
 * there is no separate "run write" to disable, so no unprotected-run
 * experiment exists for this model (see docs/domain-model.md, Decision 7).
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

/**
 * Bounded, first-attempt-only synchronisation point. `arrive()` resolves for
 * everyone once `parties` callers have arrived; if they have not all arrived
 * within `timeoutMs` every waiter rejects with a message naming who did
 * arrive — so a transaction that fails before the barrier fails the test
 * promptly instead of hanging it.
 */
function createBarrier(parties: number, timeoutMs = 10_000) {
  const arrivals: string[] = [];
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const gate = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  gate.catch(() => undefined); // avoid an unhandled rejection if nobody is awaiting when it fires
  const timer = setTimeout(
    () => reject(new Error(`Barrier timeout: expected ${parties} transactions to reach the synchronisation point, only reached: [${arrivals.join(", ")}]`)),
    timeoutMs,
  );
  return {
    arrive(label: string): Promise<void> {
      arrivals.push(label);
      if (arrivals.length === parties) {
        clearTimeout(timer);
        resolve();
      }
      return gate;
    },
    arrived: () => [...arrivals],
  };
}

/** Hook factory: counts every callback execution and holds ONLY attempt 1 at the barrier (retries bypass it). */
function barrierHook(label: string, barrier: ReturnType<typeof createBarrier>, counter: { executions: number; attempts: number[] }): TransactionHooks {
  return {
    afterFirstRead: async ({ attempt }) => {
      counter.executions += 1;
      counter.attempts.push(attempt);
      if (attempt === 1) await barrier.arrive(label);
    },
  };
}

describe("Decision 7 — skipStop / confirmPickup (real MongoDB transactions, replica set)", () => {
  let admin: AuthContext;
  let courier: AuthContext;

  beforeAll(async () => {
    await startTestReplSetDb();
    await DeliveryRun.init();
  }, 120_000);
  afterAll(stopTestReplSetDb);
  afterEach(clearTestReplSetDb);

  async function seedActiveRun(orderCount: number) {
    const adminDoc = await User.create({ phone: "09120000001", role: "admin" });
    const courierDoc = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "motorcycle" } });
    admin = { userId: adminDoc._id.toString(), role: "admin" };
    courier = { userId: courierDoc._id.toString(), role: "courier" };
    const orders = [];
    for (let i = 1; i <= orderCount; i += 1) orders.push(await makeOrder(i));
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: orders.map((o) => o._id.toString()) });
    const run = await activateRun(admin, draft.id);
    return { run, orders, stopIds: run.stops.map((s) => s.id) };
  }

  const deliveryOf = async (orderId: Types.ObjectId) => (await Order.findById(orderId))!.delivery;
  const stopStatuses = async (runId: string) => (await DeliveryRun.findById(runId))!.stops.map((s) => s.status);

  // ------------------------------------------------------------ lifecycle

  it("single stop: pending → skipped, Order assigned → unassigned (assignment fields released), Order.status untouched, run completed, one audit entry", async () => {
    const { run, orders, stopIds } = await seedActiveRun(1);
    await skipStop(courier, run.id, stopIds[0]!);

    expect(await stopStatuses(run.id)).toEqual(["skipped"]);
    const d = await deliveryOf(orders[0]!._id);
    expect(d.status).toBe("unassigned");
    expect(d.courierId).toBeUndefined();
    expect(d.assignedAt).toBeUndefined();
    expect((await Order.findById(orders[0]!._id))!.status).toBe("preparing");
    const fresh = await DeliveryRun.findById(run.id);
    expect(fresh!.status).toBe("completed"); // all-skipped = completed, never cancelled
    expect(fresh!.cancelledAt).toBeUndefined();
    const audits = await AuditLog.find({ action: "deliveryRun.stop_skipped" });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entityId.toString()).toBe(run.id);
  });

  it("two stops, one still pending → run stays active", async () => {
    const { run, stopIds } = await seedActiveRun(2);
    await skipStop(courier, run.id, stopIds[0]!);
    expect((await DeliveryRun.findById(run.id))!.status).toBe("active");
    expect(await stopStatuses(run.id)).toEqual(["skipped", "pending"]);
  });

  it("skip one, pick up and deliver the other → run completed", async () => {
    const { run, stopIds } = await seedActiveRun(2);
    await skipStop(courier, run.id, stopIds[0]!);
    expect((await confirmPickup(courier, run.id)).pickedUpCount).toBe(1); // only the still-pending stop
    await proposeStopOutcome(courier, run.id, stopIds[1]!, "delivered");
    const fresh = await DeliveryRun.findById(run.id);
    expect(fresh!.status).toBe("completed");
    expect(fresh!.stops.map((s) => s.status)).toEqual(["skipped", "delivered"]);
  });

  it("all stops skipped sequentially → run completed, both orders unassigned", async () => {
    const { run, orders, stopIds } = await seedActiveRun(2);
    await skipStop(courier, run.id, stopIds[0]!);
    await skipStop(courier, run.id, stopIds[1]!);
    expect((await DeliveryRun.findById(run.id))!.status).toBe("completed");
    for (const o of orders) expect((await deliveryOf(o._id)).status).toBe("unassigned");
  });

  it("a skipped stop is terminal: skipping it again is rejected and nothing changes", async () => {
    const { run, stopIds } = await seedActiveRun(2);
    await skipStop(courier, run.id, stopIds[0]!);
    await expect(skipStop(courier, run.id, stopIds[0]!)).rejects.toMatchObject({ code: "DELIVERY_STOP_ALREADY_RESOLVED" });
    expect(await AuditLog.countDocuments({ action: "deliveryRun.stop_skipped" })).toBe(1);
  });

  it("reassignment: the old skipped stop stays in the old run as history; the order joins a NEW run as a NEW stop", async () => {
    const { run, orders, stopIds } = await seedActiveRun(2);
    await skipStop(courier, run.id, stopIds[0]!); // run stays active (stop 2 pending)
    const old = await DeliveryRun.findById(run.id);
    const oldStop = old!.stops.find((s) => s._id.toString() === stopIds[0]!)!;
    expect(oldStop.status).toBe("skipped");

    // Finish the old run so the courier may activate another (Decision 4).
    await confirmPickup(courier, run.id);
    await proposeStopOutcome(courier, run.id, stopIds[1]!, "delivered");

    const draft2 = await createDraftRun(admin, { courierId: courier.userId, orderIds: [orders[0]!._id.toString()] });
    const run2 = await activateRun(admin, draft2.id);
    expect((await deliveryOf(orders[0]!._id)).status).toBe("assigned");
    expect(run2.id).not.toBe(run.id);
    expect(run2.stops[0]!.id).not.toBe(oldStop._id.toString());
    // The historical stop was not mutated back.
    const oldAfter = await DeliveryRun.findById(run.id);
    expect(oldAfter!.stops.find((s) => s._id.toString() === stopIds[0]!)!.status).toBe("skipped");
  });

  // ------------------------------------------------- pickup / skip ordering

  it("skip AFTER pickup is rejected: stop stays pending, order stays picked_up, no audit entry", async () => {
    const { run, orders, stopIds } = await seedActiveRun(1);
    await confirmPickup(courier, run.id);
    await expect(skipStop(courier, run.id, stopIds[0]!)).rejects.toMatchObject({ code: "ORDER_NOT_ASSIGNED" });
    expect(await stopStatuses(run.id)).toEqual(["pending"]);
    expect((await deliveryOf(orders[0]!._id)).status).toBe("picked_up");
    expect(await AuditLog.countDocuments({ action: "deliveryRun.stop_skipped" })).toBe(0);
  });

  it("pickup AFTER the only stop was skipped is rejected (run completed)", async () => {
    const { run, orders, stopIds } = await seedActiveRun(1);
    await skipStop(courier, run.id, stopIds[0]!);
    await expect(confirmPickup(courier, run.id)).rejects.toMatchObject({ code: "DELIVERY_RUN_NOT_ACTIVE" });
    expect((await deliveryOf(orders[0]!._id)).status).toBe("unassigned");
  });

  // ------------------------------------------------- atomicity / rollback

  it("confirmPickup multi-stop is all-or-nothing: if stop 2's order is no longer assigned, stop 1's pickup rolls back", async () => {
    const { run, orders } = await seedActiveRun(2);
    // Make the second pending stop's order disagree with its stop.
    await Order.updateOne({ _id: orders[1]!._id }, { $set: { "delivery.status": "unassigned" }, $unset: { "delivery.courierId": 1, "delivery.assignedAt": 1 } });
    await expect(confirmPickup(courier, run.id)).rejects.toMatchObject({ code: "ORDER_NOT_ASSIGNED" });
    expect((await deliveryOf(orders[0]!._id)).status).toBe("assigned"); // rolled back
    expect((await deliveryOf(orders[0]!._id)).pickedUpAt).toBeUndefined();
  });

  it("failed skip rolls back EVERYTHING including the audit entry and the embedded stop write", async () => {
    const { run, orders, stopIds } = await seedActiveRun(1);
    // Order moved on behind the run's back → the Order write inside the transaction matches nothing.
    await Order.updateOne({ _id: orders[0]!._id }, { $set: { "delivery.status": "picked_up", "delivery.pickedUpAt": new Date() } });
    await expect(skipStop(courier, run.id, stopIds[0]!)).rejects.toMatchObject({ code: "ORDER_NOT_ASSIGNED" });
    expect(await stopStatuses(run.id)).toEqual(["pending"]); // stop write rolled back
    expect((await DeliveryRun.findById(run.id))!.status).toBe("active");
    expect(await AuditLog.countDocuments({})).toBe(0); // audit entry rolled back
  });

  // ------------------------------------------------- concurrency

  it("RACE skipStop vs confirmPickup on the same pending stop: exactly one wins, never skipped+picked_up, never pending+unassigned", async () => {
    const { run, orders, stopIds } = await seedActiveRun(1);
    const barrier = createBarrier(2);
    const skipCounter = { executions: 0, attempts: [] as number[] };
    const pickCounter = { executions: 0, attempts: [] as number[] };

    const results = await Promise.allSettled([
      skipStop(courier, run.id, stopIds[0]!, barrierHook("skip", barrier, skipCounter)),
      confirmPickup(courier, run.id, barrierHook("pickup", barrier, pickCounter)),
    ]);

    expect(barrier.arrived().sort()).toEqual(["pickup", "skip"]); // both first attempts reached the barrier
    const [stopStatus] = await stopStatuses(run.id);
    const delivery = (await deliveryOf(orders[0]!._id)).status;

    const skipWon = stopStatus === "skipped" && delivery === "unassigned";
    const pickupWon = stopStatus === "pending" && delivery === "picked_up";
    expect(skipWon || pickupWon).toBe(true); // persisted state, not just return values
    expect(!(stopStatus === "skipped" && delivery === "picked_up")).toBe(true);
    expect(!(stopStatus === "pending" && delivery === "unassigned")).toBe(true);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["ORDER_NOT_ASSIGNED", "DELIVERY_RUN_NOT_ACTIVE"]).toContain((loser.reason as { code: string }).code);
    expect(skipCounter.executions + pickCounter.executions).toBeGreaterThanOrEqual(2);
  });

  it("WRITE SKEW: two concurrent skipStops on the last two pending stops → run completed, never active with 0 pending", async () => {
    const { run, orders, stopIds } = await seedActiveRun(2);
    const barrier = createBarrier(2);
    const counter = { executions: 0, attempts: [] as number[] };

    // Each hook runs right after that transaction's session-scoped read of the run and
    // before any write. Only attempt 1 waits at the barrier, so retries proceed.
    const results = await Promise.allSettled([
      skipStop(courier, run.id, stopIds[0]!, barrierHook("A", barrier, counter)),
      skipStop(courier, run.id, stopIds[1]!, barrierHook("B", barrier, counter)),
    ]);

    expect(barrier.arrived().sort()).toEqual(["A", "B"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const fresh = await DeliveryRun.findById(run.id);
    expect(fresh!.status).toBe("completed");
    expect(fresh!.stops.filter((s) => s.status === "pending")).toHaveLength(0);
    expect(fresh!.stops.map((s) => s.status)).toEqual(["skipped", "skipped"]);
    for (const o of orders) expect((await deliveryOf(o._id)).status).toBe("unassigned");
    expect(await AuditLog.countDocuments({ action: "deliveryRun.stop_skipped" })).toBe(2); // no audit from an aborted attempt

    // Real transaction conflict ⇒ at least one callback was re-executed through withTransaction.
    expect(counter.executions).toBeGreaterThan(2);
    expect(counter.attempts.some((a) => a >= 2)).toBe(true);
  });
});
