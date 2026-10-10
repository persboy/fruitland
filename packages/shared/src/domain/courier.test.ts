import { describe, expect, it } from "vitest";
import {
  COURIER_LIST_DEFAULT_LIMIT,
  COURIER_LIST_MAX_LIMIT,
  courierListQuerySchema,
  courierStatusSchema,
  createCourierSchema,
  isValidCourierName,
  updateCourierSchema,
} from "./courier";

const ID = "64b7f0c2a1b2c3d4e5f60718";
const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? "" : r.error!.issues.map((i) => i.message).join("؛"));

describe("createCourierSchema", () => {
  it.each(["car", "motorcycle", "bicycle"])("accepts vehicleType %s", (vehicleType) => {
    expect(createCourierSchema.parse({ userId: ID, vehicleType })).toEqual({ userId: ID, vehicleType });
  });

  it("rejects an invalid or missing vehicleType", () => {
    expect(msg(createCourierSchema.safeParse({ userId: ID, vehicleType: "spaceship" }))).toContain("نوع وسیله");
    expect(createCourierSchema.safeParse({ userId: ID }).success).toBe(false);
  });

  it("rejects a missing or malformed userId", () => {
    expect(createCourierSchema.safeParse({ vehicleType: "car" }).success).toBe(false);
    expect(createCourierSchema.safeParse({ userId: "abc", vehicleType: "car" }).success).toBe(false);
    expect(createCourierSchema.safeParse({ userId: 5, vehicleType: "car" }).success).toBe(false);
  });

  it("plateNumber is optional; empty/blank means absent; value is trimmed and Persian digits become ASCII", () => {
    expect(createCourierSchema.parse({ userId: ID, vehicleType: "car" })).not.toHaveProperty("plateNumber");
    expect(createCourierSchema.parse({ userId: ID, vehicleType: "car", plateNumber: "   " })).not.toHaveProperty("plateNumber");
    expect(createCourierSchema.parse({ userId: ID, vehicleType: "car", plateNumber: " ۱۲ الف ۳۴۵ " }).plateNumber).toBe("12 الف 345");
  });

  it("rejects an over-long plate and tag characters", () => {
    expect(createCourierSchema.safeParse({ userId: ID, vehicleType: "car", plateNumber: "1".repeat(21) }).success).toBe(false);
    expect(createCourierSchema.safeParse({ userId: ID, vehicleType: "car", plateNumber: "<b>" }).success).toBe(false);
  });

  it.each(["role", "courierProfile", "status", "currentLocation", "isActive", "createdBy", "availabilityStatus"])(
    "rejects the forbidden key %s instead of silently dropping it",
    (key) => {
      const r = createCourierSchema.safeParse({ userId: ID, vehicleType: "car", [key]: "x" });
      expect(r.success).toBe(false);
      expect(msg(r)).toContain(key);
    },
  );
});

describe("updateCourierSchema", () => {
  it("accepts vehicleType only, plateNumber only, or both", () => {
    expect(updateCourierSchema.parse({ vehicleType: "bicycle" })).toEqual({ vehicleType: "bicycle" });
    expect(updateCourierSchema.parse({ plateNumber: "12" })).toEqual({ plateNumber: "12" });
    expect(updateCourierSchema.parse({ vehicleType: "car", plateNumber: "" })).toEqual({ vehicleType: "car", plateNumber: "" });
  });

  it('keeps plateNumber "" so the service can clear it', () => {
    expect(updateCourierSchema.parse({ plateNumber: "" })).toEqual({ plateNumber: "" });
  });

  it("requires at least one editable field", () => {
    expect(updateCourierSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an invalid vehicleType and forbidden keys", () => {
    expect(updateCourierSchema.safeParse({ vehicleType: "boat" }).success).toBe(false);
    for (const key of ["role", "isActive", "phone", "courierProfile", "currentLocation", "status", "userId"]) {
      expect(updateCourierSchema.safeParse({ vehicleType: "car", [key]: 1 }).success).toBe(false);
    }
  });
});

describe("courierStatusSchema", () => {
  it("accepts an explicit boolean", () => {
    expect(courierStatusSchema.parse({ isActive: true })).toEqual({ isActive: true });
    expect(courierStatusSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });

  it.each([{}, { isActive: "true" }, { isActive: 1 }, { isActive: null }])("rejects an invalid status payload %j", (body) => {
    expect(courierStatusSchema.safeParse(body).success).toBe(false);
  });

  it("rejects availability status, location and role", () => {
    for (const key of ["status", "availabilityStatus", "currentLocation", "role"]) {
      expect(courierStatusSchema.safeParse({ isActive: true, [key]: "online" }).success).toBe(false);
    }
  });
});

describe("courierListQuerySchema", () => {
  it("applies defaults", () => {
    expect(courierListQuerySchema.parse({})).toEqual({ page: 1, limit: COURIER_LIST_DEFAULT_LIMIT, status: "all", search: undefined });
  });

  it("rejects (never clamps) out-of-range page/limit and unknown status", () => {
    expect(courierListQuerySchema.safeParse({ limit: COURIER_LIST_MAX_LIMIT + 1 }).success).toBe(false);
    expect(courierListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(courierListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(courierListQuerySchema.safeParse({ status: "busy" }).success).toBe(false);
  });

  it("search is trimmed, digit-normalised, length-capped and empty becomes undefined", () => {
    expect(courierListQuerySchema.parse({ search: "  ۰۹۱۲  " }).search).toBe("0912");
    expect(courierListQuerySchema.parse({ search: "   " }).search).toBeUndefined();
    expect(courierListQuerySchema.safeParse({ search: "a".repeat(51) }).success).toBe(false);
  });
});

describe("isValidCourierName", () => {
  it("accepts a normal name and rejects blank, missing, over-long and tag-like names", () => {
    expect(isValidCourierName("علی")).toBe(true);
    for (const bad of ["", "   ", undefined, null, 5, "a".repeat(51), "<b>x</b>"]) expect(isValidCourierName(bad)).toBe(false);
  });
});
