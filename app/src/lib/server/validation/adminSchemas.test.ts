import { describe, expect, it } from "vitest";
import { changePasswordSchema, shippingSettingsSchema, storeSettingsSchema, updateProfileSchema } from "./adminSchemas";

describe("shippingSettingsSchema (integer Toman only)", () => {
  it("accepts whole non-negative numbers, including 0", () => {
    expect(shippingSettingsSchema.safeParse({ expressDeliveryFee: 0, freeDeliveryThreshold: 500000 }).success).toBe(true);
  });
  it.each([
    [{ expressDeliveryFee: 100.5, freeDeliveryThreshold: 1 }],
    [{ expressDeliveryFee: -1, freeDeliveryThreshold: 1 }],
    [{ expressDeliveryFee: "25000", freeDeliveryThreshold: 1 }],
    [{ expressDeliveryFee: 1 }],
    [{ expressDeliveryFee: 1, freeDeliveryThreshold: Number.NaN }],
  ])("rejects %j", (body) => {
    expect(shippingSettingsSchema.safeParse(body).success).toBe(false);
  });
});

describe("storeSettingsSchema", () => {
  it("requires name and support phone, trims, allows empty address", () => {
    const ok = storeSettingsSchema.parse({ storeName: "  پرزبوی ", supportPhone: " 0241 ", address: "" });
    expect(ok).toEqual({ storeName: "پرزبوی", supportPhone: "0241", address: "" });
    expect(storeSettingsSchema.safeParse({ storeName: " ", supportPhone: "1", address: "" }).success).toBe(false);
    expect(storeSettingsSchema.safeParse({ storeName: "a", supportPhone: "", address: "" }).success).toBe(false);
  });
});

describe("changePasswordSchema / updateProfileSchema", () => {
  it("enforces the 8-character minimum", () => {
    expect(changePasswordSchema.safeParse({ newPassword: "1234567" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ newPassword: "12345678" }).success).toBe(true);
  });
  it("allows clearing names but caps their length", () => {
    expect(updateProfileSchema.safeParse({ firstName: "", lastName: "" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ firstName: "a".repeat(51), lastName: "" }).success).toBe(false);
  });
});
