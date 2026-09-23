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

  it("accepts a valid embedded address", () => {
    const doc = new User({
      phone: "09120000000",
      addresses: [
        {
          recipientName: "Ali",
          phone: "09120000000",
          province: "Tehran",
          city: "Tehran",
          addressLine: "Valiasr St.",
        },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.addresses[0]?.label).toBe("home"); // default
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
