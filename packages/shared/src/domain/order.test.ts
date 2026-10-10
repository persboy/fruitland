import { describe, expect, it } from "vitest";
import { cancelOrderSchema, orderListQuerySchema, ORDER_LIST_DEFAULT_LIMIT, ORDER_LIST_MAX_LIMIT } from "./order";

describe("orderListQuerySchema", () => {
  it("applies defaults", () => {
    expect(orderListQuerySchema.parse({})).toEqual({ page: 1, limit: ORDER_LIST_DEFAULT_LIMIT });
  });
  it("accepts every real status / deliveryStatus / source value and treats empty as absent", () => {
    for (const status of ["preparing", "shipped", "delivered", "cancelled", "returned"]) expect(orderListQuerySchema.parse({ status }).status).toBe(status);
    for (const deliveryStatus of ["unassigned", "assigned", "picked_up", "proposed", "resolved", "emergency_cancelled"]) {
      expect(orderListQuerySchema.parse({ deliveryStatus }).deliveryStatus).toBe(deliveryStatus);
    }
    for (const source of ["online", "phone"]) expect(orderListQuerySchema.parse({ source }).source).toBe(source);
    expect(orderListQuerySchema.parse({ status: "" }).status).toBeUndefined();
  });
  it("rejects unknown enum values (no guessing) and out-of-range paging", () => {
    for (const q of [{ status: "paid" }, { deliveryStatus: "lost" }, { source: "app" }, { page: 0 }, { page: "x" }, { limit: 0 }, { limit: ORDER_LIST_MAX_LIMIT + 1 }]) {
      expect(orderListQuerySchema.safeParse(q).success).toBe(false);
    }
  });
  it("search: trimmed, digits normalised, ≤ 50, blank → undefined", () => {
    expect(orderListQuerySchema.parse({ search: " ۰۰۰۱۲۳ " }).search).toBe("000123");
    expect(orderListQuerySchema.parse({ search: "  " }).search).toBeUndefined();
    expect(orderListQuerySchema.safeParse({ search: "a".repeat(51) }).success).toBe(false);
  });
});

describe("cancelOrderSchema", () => {
  it("trims and requires a non-blank reason", () => {
    expect(cancelOrderSchema.parse({ reason: "  مشتری لغو کرد  " })).toEqual({ reason: "مشتری لغو کرد" });
    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 5 }, { reason: null }]) expect(cancelOrderSchema.safeParse(body).success).toBe(false);
  });
  it("caps the reason length", () => {
    expect(cancelOrderSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    expect(cancelOrderSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
  it("rejects every other key (status, isPaid, canceledByUserId …)", () => {
    for (const key of ["status", "isPaid", "paidAt", "canceledByUserId", "delivery", "deliveryStatus"]) {
      expect(cancelOrderSchema.safeParse({ reason: "x", [key]: "y" }).success).toBe(false);
    }
  });
});
