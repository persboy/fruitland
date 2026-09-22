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
});
