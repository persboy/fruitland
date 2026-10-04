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
  cancelRun,
  confirmPickup,
  createDraftRun,
  skipStop,
  type TransactionHooks,
} from "./deliveryRunService";

/**
 * Decision 8 — REAL MONGODB TRANSACTION tests for active `cancelRun`
 * (single-node replica set via `MongoMemoryReplSet`). Standalone MongoDB
 * cannot run these at all.
 *
 * Authoritative execution (dev/CI, network access to fastdl.mongodb.org or a
 * local `mongod` configured as a replica set):
 *
 *   npm run test:integration --workspace=app -- src/lib/server/services/deliveryRunService.cancel.integration.test.ts
 *
 * If the MongoDB binary cannot be obtained these tests do NOT run, and
 * nothing here may be reported as passed: report "Integration verification
 * blocked by environment" with the actual reason instead.
 *
 * Races use the service's own transactions and the optional test-only
 * `TransactionHooks.afterFirstRead` barrier (first attempt only) — no
 * direct database edits during a race, no mocks.
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

describe("Decision 8 — active cancelRun (real MongoDB transactions, replica set)", () => {
  let admin: AuthContext;
  let admin2: AuthContext;
  let courier: AuthContext;

  beforeAll(async () => {
    await startTestReplSetDb();
    await DeliveryRun.init();
  }, 120_000);
  afterAll(stopTestReplSetDb);
  afterEach(clearTestReplSetDb);

  async function seedActiveRun(orderCount: number) {
    const adminDoc = await User.create({ phone: "09120000001", role: "admin" });
    const admin2Doc = await User.create({ phone: "09120000003", role: "admin" });
    const courierDoc = await User.create({ phone: "09120000002", role: "courier", courierProfile: { vehicleType: "motorcycle" } });
    admin = { userId: adminDoc._id.toString(), role: "admin" };
    admin2 = { userId: admin2Doc._id.toString(), role: "admin" };
    courier = { userId: courierDoc._id.toString(), role: "courier" };
    const orders = [];
    for (let i = 1; i <= orderCount; i += 1) orders.push(await makeOrder(i));
    const draft = await createDraftRun(admin, { courierId: courier.userId, orderIds: orders.map((o) => o._id.toString()) });
    const run = await activateRun(admin, draft.id);
    return { run, orders, stopIds: run.stops.map((s) => s.id) };
  }

  const deliveryOf = async (orderId: Types.ObjectId) => (await Order.findById(orderId))!.delivery;
  const runOf = async (runId: string) => (await DeliveryRun.findById(runId))!;

  // ------------------------------------------------------------ sequential semantics

  it("no picked-up order: run cancelled, every order released (assignment fields cleared), Order.status untouched, no AuditLog", async () => {
    const { run, orders } = await seedActiveRun(2);
    const dto = await cancelRun(admin, run.id);
    expect(dto.status).toBe("cancelled");
    for (const o of orders) {
      const d = await deliveryOf(o._id);
      expect(d.status).toBe("unassigned");
      expect(d.courierId).toBeUndefined();
      expect(d.assignedAt).toBeUndefined();
      expect((await Order.findById(o._id))!.status).toBe("preparing");
    }
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it("a picked-up order: RUN_HAS_PICKED_UP_ORDERS, run still active, nothing released", async () => {
    const { run, orders } = await seedActiveRun(2);
    await confirmPickup(courier, run.id);
    await expect(cancelRun(admin, run.id)).rejects.toMatchObject({ code: "RUN_HAS_PICKED_UP_ORDERS", status: 409 });
    expect((await runOf(run.id)).status).toBe("active");
    for (const o of orders) expect((await deliveryOf(o._id)).status).toBe("picked_up");
  });

  it("SKIPPED stop is ignored: run with one skipped + one pending stop is cancellable; skipped stop and its unassigned order are untouched", async () => {
    const { run, orders, stopIds } = await seedActiveRun(2);
    await skipStop(courier, run.id, stopIds[0]!); // run stays active
    // The skipped order is free again — simulate it being assigned elsewhere is NOT done here; it must simply be left alone.
    const before = (await Order.findById(orders[0]!._id).lean())!.delivery;

    const dto = await cancelRun(admin, run.id);
    expect(dto.status).toBe("cancelled");
    const fresh = await runOf(run.id);
    expect(fresh.stops.map((s) => s.status)).toEqual(["skipped", "pending"]); // skipped stays skipped
    expect((await deliveryOf(orders[0]!._id)).status).toBe("unassigned");
    expect((await Order.findById(orders[0]!._id).lean())!.delivery).toEqual(before); // not written by cancel
    expect((await deliveryOf(orders[1]!._id)).status).toBe("unassigned"); // pending stop's order released
  });

  it("release mismatch rolls EVERYTHING back (run stays active, the other order stays assigned)", async () => {
    const { run, orders } = await seedActiveRun(2);
    // Order 2 now belongs to a different courier than the run's: the pre-check passes (still `assigned`)
    // but the conditional release cannot match it → modifiedCount 1 ≠ 2.
    await Order.updateOne({ _id: orders[1]!._id }, { $set: { "delivery.courierId": new Types.ObjectId() } });
    await expect(cancelRun(admin, run.id)).rejects.toMatchObject({ code: "RUN_ORDER_RELEASE_MISMATCH", status: 409 });
    const fresh = await runOf(run.id);
    expect(fresh.status).toBe("active");
    expect(fresh.cancelledAt).toBeUndefined();
    expect((await deliveryOf(orders[0]!._id)).status).toBe("assigned"); // its release was rolled back
    expect((await deliveryOf(orders[1]!._id)).status).toBe("assigned"); // untouched (other courier's)
  });

  it("repeated cancellation stays a conflict (INVALID_RUN_TRANSITION), not an idempotent success", async () => {
    const { run } = await seedActiveRun(1);
    await cancelRun(admin, run.id);
    await expect(cancelRun(admin, run.id)).rejects.toMatchObject({ code: "INVALID_RUN_TRANSITION", status: 409 });
  });

  // ------------------------------------------------------------ races

  it("RACE A — cancelRun vs confirmPickup: exactly one wins; never cancelled run + picked_up order", async () => {
    const { run, orders } = await seedActiveRun(1);
    const barrier = createBarrier(2);
    const cancelCounter = { executions: 0, attempts: [] as number[] };
    const pickCounter = { executions: 0, attempts: [] as number[] };

    const results = await Promise.allSettled([
      cancelRun(admin, run.id, barrierHook("cancel", barrier, cancelCounter)),
      confirmPickup(courier, run.id, barrierHook("pickup", barrier, pickCounter)),
    ]);

    expect(barrier.arrived().sort()).toEqual(["cancel", "pickup"]);
    const fresh = await runOf(run.id);
    const delivery = await deliveryOf(orders[0]!._id);

    // Persisted state, not just return values.
    expect(!(fresh.status === "cancelled" && delivery.status === "picked_up")).toBe(true);
    const cancelWon = fresh.status === "cancelled" && delivery.status === "unassigned";
    const pickupWon = fresh.status === "active" && delivery.status === "picked_up";
    expect(cancelWon || pickupWon).toBe(true);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    if (pickupWon) {
      expect(results[1]!.status).toBe("fulfilled");
      expect((results[1] as PromiseFulfilledResult<{ pickedUpCount: number }>).value.pickedUpCount).toBe(1);
      expect(results[0]!.status).toBe("rejected");
      expect(((results[0] as PromiseRejectedResult).reason as { code: string }).code).toBe("RUN_HAS_PICKED_UP_ORDERS");
      expect(fresh.cancelledAt).toBeUndefined();
    } else {
      expect(results[0]!.status).toBe("fulfilled");
      expect(results[1]!.status).toBe("rejected");
      expect(((results[1] as PromiseRejectedResult).reason as { code: string }).code).toBe("PICKUP_STOP_NO_LONGER_PENDING");
      expect(delivery.pickedUpAt).toBeUndefined();
    }
    // A real transaction conflict ⇒ the loser's callback was re-executed by withTransaction.
    expect(cancelCounter.attempts.some((a) => a >= 2) || pickCounter.attempts.some((a) => a >= 2)).toBe(true);
  });

  it("RACE B — cancelRun vs skipStop: exactly one wins; final state valid under Decisions 7 and 8", async () => {
    const { run, orders, stopIds } = await seedActiveRun(1);
    const barrier = createBarrier(2);
    const cancelCounter = { executions: 0, attempts: [] as number[] };
    const skipCounter = { executions: 0, attempts: [] as number[] };

    const results = await Promise.allSettled([
      cancelRun(admin, run.id, barrierHook("cancel", barrier, cancelCounter)),
      skipStop(courier, run.id, stopIds[0]!, barrierHook("skip", barrier, skipCounter)),
    ]);

    expect(barrier.arrived().sort()).toEqual(["cancel", "skip"]);
    const fresh = await runOf(run.id);
    const stop = fresh.stops[0]!.status;
    const delivery = (await deliveryOf(orders[0]!._id)).status;

    expect(delivery).not.toBe("picked_up");
    expect(!(fresh.status === "cancelled" && stop === "skipped")).toBe(true); // cancel never mutates a stop, skip never mutates a cancelled run
    const cancelWon = fresh.status === "cancelled" && stop === "pending" && delivery === "unassigned";
    const skipWon = fresh.status === "completed" && stop === "skipped" && delivery === "unassigned"; // all-skipped = completed (Decision 7)
    expect(cancelWon || skipWon).toBe(true);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser).toBeDefined();
    if (cancelWon) {
      expect(results[0]!.status).toBe("fulfilled");
      expect((loser.reason as { code: string }).code).toBe("DELIVERY_RUN_NOT_ACTIVE");
      expect(await AuditLog.countDocuments({ action: "deliveryRun.stop_skipped" })).toBe(0); // aborted skip left no audit entry
    } else {
      expect(results[1]!.status).toBe("fulfilled");
      expect((loser.reason as { code: string }).code).toBe("INVALID_RUN_TRANSITION"); // run already completed by the winning skip
      expect(fresh.cancelledAt).toBeUndefined();
    }
    expect(cancelCounter.attempts.some((a) => a >= 2) || skipCounter.attempts.some((a) => a >= 2)).toBe(true);
  });

  it("RACE C — two concurrent cancelRun calls: one succeeds, the other gets the existing conflict; one release; consistent state", async () => {
    const { run, orders } = await seedActiveRun(1);
    const barrier = createBarrier(2);
    const counterA = { executions: 0, attempts: [] as number[] };
    const counterB = { executions: 0, attempts: [] as number[] };

    const results = await Promise.allSettled([
      cancelRun(admin, run.id, barrierHook("A", barrier, counterA)),
      cancelRun(admin2, run.id, barrierHook("B", barrier, counterB)),
    ]);

    expect(barrier.arrived().sort()).toEqual(["A", "B"]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser).toBeDefined();
    expect((loser.reason as { code: string }).code).toBe("INVALID_RUN_TRANSITION"); // not an idempotent success

    const fresh = await runOf(run.id);
    expect(fresh.status).toBe("cancelled");
    const winner = results[0]!.status === "fulfilled" ? admin : admin2;
    expect(fresh.cancelledByUserId!.toString()).toBe(winner.userId); // the persisted cancellation belongs to the winner only
    const d = await deliveryOf(orders[0]!._id);
    expect(d.status).toBe("unassigned");
    expect(d.courierId).toBeUndefined();
    expect(counterA.attempts.some((a) => a >= 2) || counterB.attempts.some((a) => a >= 2)).toBe(true);
  });
});
