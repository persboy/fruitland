import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";

describe("addressService (integration)", () => {
  beforeAll(async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://placeholder/unused");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
    await startTestDb();
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await stopTestDb();
  });
  afterEach(async () => {
    await clearTestDb();
  });

  const base = {
    recipientName: "علی رضایی",
    phone: "09120000000",
    province: "تهران",
    city: "تهران",
    addressLine: "خیابان ولیعصر",
    location: { latitude: 35.7, longitude: 51.4 },
  };

  async function createUser() {
    const { User } = await import("../models/User");
    const user = await User.create({ phone: `0912${Math.floor(Math.random() * 1e7)}`, role: "customer" });
    return user._id.toString();
  }

  it("creates, lists, gets, updates and deletes an address for its owner", async () => {
    const { createAddress, listAddresses, getAddress, updateAddress, deleteAddress } = await import("./addressService");
    const userId = await createUser();

    const created = await createAddress(userId, base);
    expect(created.resolvedBy).toBeNull(); // never accepted from input, always absent on create
    expect(await listAddresses(userId)).toEqual([created]);
    expect(await getAddress(userId, created.id)).toEqual(created);

    const updated = await updateAddress(userId, created.id, { addressLine: "خیابان ولیعصر، پلاک ۱۰" });
    expect(updated.addressLine).toBe("خیابان ولیعصر، پلاک ۱۰");
    expect(updated.recipientName).toBe(base.recipientName); // untouched fields survive a partial update

    await deleteAddress(userId, created.id);
    expect(await listAddresses(userId)).toEqual([]);
  });

  it("never lets one user read, update or delete another user's address (404, not a leak)", async () => {
    const { createAddress, getAddress, updateAddress, deleteAddress } = await import("./addressService");
    const owner = await createUser();
    const intruder = await createUser();
    const address = await createAddress(owner, base);

    await expect(getAddress(intruder, address.id)).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    await expect(updateAddress(intruder, address.id, { addressLine: "hacked" })).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    await expect(deleteAddress(intruder, address.id)).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    // and it's untouched
    expect((await getAddress(owner, address.id)).addressLine).toBe(base.addressLine);
  });

  it("a malformed or nonexistent address id is handled as not-found, not a crash", async () => {
    const { getAddress } = await import("./addressService");
    const userId = await createUser();
    await expect(getAddress(userId, "not-an-object-id")).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    await expect(getAddress(userId, "64b7f0c2a1b2c3d4e5f60718")).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
  });

  it("rejects invalid coordinates and missing required fields at creation", async () => {
    const { createAddress } = await import("./addressService");
    const userId = await createUser();
    await expect(createAddress(userId, { ...base, location: { latitude: 999, longitude: 0 } })).rejects.toThrow();
    const { addressLine: _omit, ...missingAddressLine } = base;
    void _omit;
    await expect(createAddress(userId, missingAddressLine as never)).rejects.toThrow();
  });

  it("default invariant: at most one default address ever exists, via create, update, or the dedicated set-default operation", async () => {
    const { createAddress, updateAddress, setDefaultAddress, listAddresses } = await import("./addressService");
    const userId = await createUser();

    const a = await createAddress(userId, { ...base, isDefault: true });
    const b = await createAddress(userId, { ...base, addressLine: "b", isDefault: true });
    let all = await listAddresses(userId);
    expect(all.filter((x) => x.isDefault)).toHaveLength(1);
    expect(all.find((x) => x.id === b.id)?.isDefault).toBe(true);
    expect(all.find((x) => x.id === a.id)?.isDefault).toBe(false);

    await updateAddress(userId, a.id, { isDefault: true });
    all = await listAddresses(userId);
    expect(all.filter((x) => x.isDefault)).toHaveLength(1);
    expect(all.find((x) => x.id === a.id)?.isDefault).toBe(true);

    const c = await createAddress(userId, { ...base, addressLine: "c" }); // no isDefault → does not disturb the existing default
    all = await listAddresses(userId);
    expect(all.filter((x) => x.isDefault)).toHaveLength(1);
    expect(all.find((x) => x.id === c.id)?.isDefault).toBe(false);

    await setDefaultAddress(userId, c.id);
    all = await listAddresses(userId);
    expect(all.filter((x) => x.isDefault)).toHaveLength(1);
    expect(all.find((x) => x.id === c.id)?.isDefault).toBe(true);
  });

  it("creating an address without isDefault does NOT auto-default it (no invented business rule)", async () => {
    const { createAddress } = await import("./addressService");
    const userId = await createUser();
    const first = await createAddress(userId, base);
    expect(first.isDefault).toBe(false);
  });
});
