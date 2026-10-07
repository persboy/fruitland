import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { DiscountCode } from "./DiscountCode";

describe("DiscountCode schema", () => {
  it("uppercases the code", () => {
    const doc = new DiscountCode({ code: "welcome10", type: "public", percentage: 10 });
    expect(doc.code).toBe("WELCOME10");
  });

  it("rejects a percentage outside 1-100", () => {
    const doc = new DiscountCode({ code: "X", type: "public", percentage: 150 });
    const err = doc.validateSync();
    expect(err?.errors.percentage).toBeDefined();
  });

  it("requires ownerUserId when type is personal", () => {
    const doc = new DiscountCode({ code: "PERSONAL1", type: "personal", percentage: 10 });
    const err = doc.validateSync();
    expect(err?.errors.ownerUserId).toBeDefined();
  });

  it("accepts a personal code with an ownerUserId", () => {
    const doc = new DiscountCode({
      code: "PERSONAL1",
      type: "personal",
      percentage: 10,
      ownerUserId: new Types.ObjectId(),
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("does not require ownerUserId for a public code", () => {
    const doc = new DiscountCode({ code: "PUBLIC1", type: "public", percentage: 10 });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("defaults usedCount to 0 and isActive to true", () => {
    const doc = new DiscountCode({ code: "X", type: "public", percentage: 10 });
    expect(doc.usedCount).toBe(0);
    expect(doc.isActive).toBe(true);
  });

  it("rejects a fractional percentage", () => {
    const doc = new DiscountCode({ code: "X", type: "public", percentage: 10.5 });
    expect(doc.validateSync()?.errors.percentage).toBeDefined();
  });

  it("rejects a fractional or non-positive usageLimit and accepts a missing one (unlimited)", () => {
    expect(new DiscountCode({ code: "X", type: "public", percentage: 10, usageLimit: 1.5 }).validateSync()?.errors.usageLimit).toBeDefined();
    expect(new DiscountCode({ code: "X", type: "public", percentage: 10, usageLimit: 0 }).validateSync()?.errors.usageLimit).toBeDefined();
    const unlimited = new DiscountCode({ code: "X", type: "public", percentage: 10 });
    expect(unlimited.validateSync()).toBeUndefined();
    expect(unlimited.usageLimit).toBeUndefined();
  });

  it("rejects a zero/negative/fractional maxDiscountAmount and a negative minOrderAmount", () => {
    for (const v of [0, -5, 1.5]) {
      expect(new DiscountCode({ code: "X", type: "public", percentage: 10, maxDiscountAmount: v }).validateSync()?.errors.maxDiscountAmount).toBeDefined();
    }
    expect(new DiscountCode({ code: "X", type: "public", percentage: 10, minOrderAmount: -1 }).validateSync()?.errors.minOrderAmount).toBeDefined();
    expect(new DiscountCode({ code: "X", type: "public", percentage: 10, minOrderAmount: 0, maxDiscountAmount: 50000 }).validateSync()).toBeUndefined();
  });
});
