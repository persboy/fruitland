import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { User } from "./User";

describe("User schema", () => {
  it("requires phone", () => {
    const doc = new User({ role: "customer" });
    const err = doc.validateSync();
    expect(err?.errors.phone).toBeDefined();
  });

  it("rejects an unknown role", () => {
    const doc = new User({ phone: "09120000000", role: "superuser" });
    const err = doc.validateSync();
    expect(err?.errors.role).toBeDefined();
  });

  it("defaults role to customer and isActive to true", () => {
    const doc = new User({ phone: "09120000000" });
    expect(doc.role).toBe("customer");
    expect(doc.isActive).toBe(true);
    expect(doc.validateSync()).toBeUndefined();
  });

  it("accepts a valid embedded address (province/city/district/neighborhood/street + required location)", () => {
    const doc = new User({
      phone: "09120000000",
      addresses: [
        {
          recipientName: "Ali",
          phone: "09120000000",
          province: "Tehran",
          city: "Tehran",
          district: "منطقه ۵",
          neighborhood: "صادقیه",
          street: "آیت‌الله کاشانی",
          alley: "۱۲",
          plaque: "۴",
          unit: "۲",
          addressLine: "Valiasr St.",
          deliveryNotes: "زنگ همسایه را بزنید",
          location: { latitude: 35.719934, longitude: 51.340742 },
        },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.addresses[0]?.label).toBe("home"); // default
    expect(doc.addresses[0]?.district).toBe("منطقه ۵");
  });

  it("requires a location (coordinates are never optional — map spec §20)", () => {
    const doc = new User({
      phone: "09120000000",
      addresses: [{ recipientName: "Ali", phone: "09120000000", province: "Tehran", city: "Tehran", addressLine: "Valiasr St." }],
    });
    const err = doc.validateSync();
    expect(err?.errors["addresses.0.location"]).toBeDefined();
  });

  it.each([
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: 0, longitude: 181 }],
  ])("rejects out-of-range coordinates %j", (location) => {
    const doc = new User({
      phone: "09120000000",
      addresses: [{ recipientName: "Ali", phone: "09120000000", province: "Tehran", city: "Tehran", addressLine: "Valiasr St.", location }],
    });
    const err = doc.validateSync();
    expect(err?.errors["addresses.0.location.latitude"] ?? err?.errors["addresses.0.location.longitude"]).toBeDefined();
  });

  it("stores optional provider provenance (resolvedBy) without it being required", () => {
    const doc = new User({
      phone: "09120000000",
      addresses: [
        {
          recipientName: "Ali",
          phone: "09120000000",
          province: "Tehran",
          city: "Tehran",
          addressLine: "Valiasr St.",
          location: { latitude: 35.7, longitude: 51.3 },
          resolvedBy: { provider: "neshan", providerPlaceId: null, resolvedAt: new Date("2026-01-01") },
        },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.addresses[0]?.resolvedBy?.provider).toBe("neshan");
  });

  it("rejects an unknown resolvedBy.provider", () => {
    const doc = new User({
      phone: "09120000000",
      addresses: [
        {
          recipientName: "Ali",
          phone: "09120000000",
          province: "Tehran",
          city: "Tehran",
          addressLine: "Valiasr St.",
          location: { latitude: 35.7, longitude: 51.3 },
          resolvedBy: { provider: "bing", providerPlaceId: null, resolvedAt: new Date() },
        },
      ],
    });
    const err = doc.validateSync();
    expect(err?.errors["addresses.0.resolvedBy.provider"]).toBeDefined();
  });

  it("rejects a courier profile with an invalid vehicle type", () => {
    const doc = new User({
      phone: "09120000000",
      role: "courier",
      courierProfile: { vehicleType: "spaceship" },
    });
    const err = doc.validateSync();
    expect(err?.errors["courierProfile.vehicleType"]).toBeDefined();
  });

  it("accepts a valid courier profile", () => {
    const doc = new User({
      phone: "09120000000",
      role: "courier",
      courierProfile: { vehicleType: "motorcycle" },
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.courierProfile?.status).toBe("offline"); // default
  });

  it("accepts an optional referredByUserId as an ObjectId", () => {
    const doc = new User({ phone: "09120000000", referredByUserId: new Types.ObjectId() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it("defaults passwordFailedAttempts to 0 and strips password fields from toJSON even if set", () => {
    const doc = new User({ phone: "09120000000" });
    expect(doc.passwordFailedAttempts).toBe(0);
    doc.passwordHash = "some-bcrypt-hash";
    const json = doc.toJSON() as Record<string, unknown>;
    expect(json.passwordHash).toBeUndefined();
    expect(json.passwordFailedAttempts).toBeUndefined();
  });
});
