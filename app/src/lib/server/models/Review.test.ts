import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Review } from "./Review";
import { ReviewAttribute } from "./ReviewAttribute";

describe("Review schema", () => {
  it("requires orderId, productId and userId", () => {
    const doc = new Review({});
    const err = doc.validateSync();
    expect(err?.errors.orderId).toBeDefined();
    expect(err?.errors.productId).toBeDefined();
    expect(err?.errors.userId).toBeDefined();
  });

  it("accepts a valid review with attribute values", () => {
    const doc = new Review({
      orderId: new Types.ObjectId(),
      productId: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      attributes: [{ attributeKey: "freshness", value: 5 }],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.isVisible).toBe(true);
  });
});

describe("ReviewAttribute schema", () => {
  it("requires key and label", () => {
    const doc = new ReviewAttribute({});
    const err = doc.validateSync();
    expect(err?.errors.key).toBeDefined();
    expect(err?.errors.label).toBeDefined();
  });

  it("defaults to a 1-5 rating scale", () => {
    const doc = new ReviewAttribute({ key: "freshness", label: "تازگی" });
    expect(doc.type).toBe("rating");
    expect(doc.minValue).toBe(1);
    expect(doc.maxValue).toBe(5);
  });

  it("lowercases the key", () => {
    const doc = new ReviewAttribute({ key: "FRESHNESS", label: "تازگی" });
    expect(doc.key).toBe("freshness");
  });
});
