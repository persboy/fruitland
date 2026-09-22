import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "./testDb";
import { User } from "./User";
import { DiscountCode } from "./DiscountCode";
import { Review } from "./Review";
import { getNextOrderNumber, OrderCounter } from "./OrderCounter";
import { tryClaimMasterAdmin, SystemState } from "./SystemState";

/**
 * These tests need a real MongoDB (uniqueness/index enforcement is a
 * database-level guarantee, not something `validateSync()` can check — see
 * Domain Modeling prompt §42: "test the actual persistence behavior").
 * mongodb-memory-server downloads a MongoDB binary on first run; if that
 * download is blocked by network policy, these tests fail with a network
 * error unrelated to the schemas themselves (same known limitation already
 * recorded in CLAUDE.md for Playwright).
 */
describe("Model persistence (integration)", () => {
  beforeAll(async () => {
    await startTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it("enforces unique phone on User at the database level", async () => {
    await User.create({ phone: "09120000000" });
    await expect(User.create({ phone: "09120000000" })).rejects.toThrow(/duplicate key/i);
  });

  it("enforces unique code on DiscountCode at the database level", async () => {
    await DiscountCode.create({ code: "WELCOME10", type: "public", percentage: 10 });
    await expect(
      DiscountCode.create({ code: "welcome10", type: "public", percentage: 20 }),
    ).rejects.toThrow(/duplicate key/i); // uppercase transform means these collide
  });

  it("enforces one review per (orderId, productId) via the compound unique index", async () => {
    const orderId = new Types.ObjectId();
    const productId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    await Review.create({ orderId, productId, userId });
    await expect(Review.create({ orderId, productId, userId })).rejects.toThrow(/duplicate key/i);
  });

  it("getNextOrderNumber increments atomically and never repeats", async () => {
    const numbers = await Promise.all(Array.from({ length: 10 }, () => getNextOrderNumber()));
    expect(new Set(numbers).size).toBe(10);
    const counterDoc = await OrderCounter.findOne({ key: "order_number" });
    expect(counterDoc?.seq).toBe(10);
  });

  it("tryClaimMasterAdmin only lets the first concurrent caller win", async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const [resultA, resultB] = await Promise.all([
      tryClaimMasterAdmin(userA),
      tryClaimMasterAdmin(userB),
    ]);
    // Exactly one of the two concurrent calls must have won the race.
    expect([resultA, resultB].filter(Boolean)).toHaveLength(1);
    const state = await SystemState.findOne({ key: "singleton" });
    expect(state?.masterAdminUserId).toBeDefined();
  });
});
