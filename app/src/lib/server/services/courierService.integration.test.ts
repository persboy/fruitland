import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestReplSetDb, stopTestReplSetDb, clearTestReplSetDb } from "../models/testDbReplSet";
import { AuditLog } from "../models/AuditLog";
import { DeliveryRun } from "../models/DeliveryRun";
import { Order } from "../models/Order";
import { User } from "../models/User";
import type { AuthContext } from "../auth/guard";
import { activateRun, createDraftRun } from "./deliveryRunService";
import { createCourier, getCourier, setCourierActive, updateCourier } from "./courierService";

/**
 * Real-MongoDB (REPLICA SET) tests for Page 8. Same known limitation as the other
 * *.integration.test.ts files: the mongodb-memory-server binary is not downloadable in
 * the sandbox, so these were WRITTEN BUT NOT EXECUTED there — run
 * `npm run test:integration` in dev/CI. A replica set is required because deactivation
 * and run activation are real multi-document transactions.
 */
const address = { recipientName: "Ali", phone: "09120000000", province: "Zanjan", city: "Zanjan", addressLine: "Same St. 1", location: { lat: 36.68, lng: 48.5 } };
let orderSeq = 0;
const makeOrder = () =>
  Order.create({
    orderNumber: String(++orderSeq).padStart(6, "0"),
    userId: new Types.ObjectId(),
    items: [{ productId: new Types.ObjectId(), productName: "سیب", unit: "kg", unitPrice: 1000, quantity: 1, lineTotal: 1000 }],
    deliveryAddress: address,
    subtotalAmount: 1000,
    totalAmount: 1000,
  });

let admin: AuthContext;
let adminId: string;
let phoneSeq = 0;
const phone = () => `0912${String(1000000 + ++phoneSeq)}`;
const customer = (over: Record<string, unknown> = {}) => User.create({ phone: phone(), role: "customer", firstName: "علی", lastName: "رضایی", ...over });

beforeAll(async () => {
  await startTestReplSetDb();
  await DeliveryRun.init();
}, 120_000);
afterAll(stopTestReplSetDb);
afterEach(clearTestReplSetDb);

async function seedAdmin() {
  const a = await User.create({ phone: phone(), role: "admin" });
  adminId = a._id.toString();
  admin = { userId: adminId, role: "admin" };
}

async function activeCourierWithDraft() {
  await seedAdmin();
  const c = await customer();
  await createCourier(adminId, { userId: c._id.toString(), vehicleType: "motorcycle" });
  const order = await makeOrder();
  const draft = await createDraftRun(admin, { courierId: c._id.toString(), orderIds: [order._id.toString()] });
  return { courierId: c._id.toString(), runId: draft.id };
}

describe("createCourier (real MongoDB)", () => {
  it("promotes an active named customer: role courier, offline profile, nothing else lost, one audit", async () => {
    await seedAdmin();
    const c = await customer({ addresses: [{ label: "خانه", recipientName: "ع", phone: "09120000000", province: "p", city: "c", addressLine: "a" }] });
    const dto = await createCourier(adminId, { userId: c._id.toString(), vehicleType: "car", plateNumber: "12ب345" });
    expect(dto).toMatchObject({ vehicleType: "car", plateNumber: "12ب345", availabilityStatus: "offline", isActive: true });
    const raw = await User.findById(c._id).lean();
    expect(raw?.role).toBe("courier");
    expect(raw?.addresses).toHaveLength(1);
    expect(raw?.courierProfile?.currentLocation).toBeUndefined();
    expect(await AuditLog.countDocuments({ action: "courier.created", entityId: c._id })).toBe(1);
  });

  it.each([
    ["inactive", { isActive: false }, "COURIER_CANDIDATE_INACTIVE"],
    ["no first name", { firstName: undefined }, "COURIER_CANDIDATE_PROFILE_INCOMPLETE"],
    ["admin", { role: "admin" }, "COURIER_CANDIDATE_NOT_CUSTOMER"],
    ["master admin", { role: "master_admin" }, "COURIER_CANDIDATE_NOT_CUSTOMER"],
    ["already courier", { role: "courier", courierProfile: { vehicleType: "car" } }, "USER_ALREADY_COURIER"],
  ])("rejects %s and leaves the user and the audit log untouched", async (_n, over, code) => {
    await seedAdmin();
    const u = await customer(over);
    await expect(createCourier(adminId, { userId: u._id.toString(), vehicleType: "car" })).rejects.toMatchObject({ code });
    const after = await User.findById(u._id).lean();
    expect(after?.role).toBe(u.role);
    expect(await AuditLog.countDocuments({ action: "courier.created" })).toBe(0);
  });

  it("rejects an unknown user id", async () => {
    await seedAdmin();
    await expect(createCourier(adminId, { userId: new Types.ObjectId().toString(), vehicleType: "car" })).rejects.toMatchObject({ code: "COURIER_CANDIDATE_NOT_FOUND" });
  });

  it("concurrent promotion of the same customer: exactly one succeeds, one audit", async () => {
    await seedAdmin();
    const c = await customer();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createCourier(adminId, { userId: c._id.toString(), vehicleType: "bicycle" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(["USER_ALREADY_COURIER", "COURIER_PROMOTION_CONFLICT"]).toContain((r.reason as { code: string }).code);
    expect(await AuditLog.countDocuments({ action: "courier.created" })).toBe(1);
  });
});

describe("updateCourier (real MongoDB)", () => {
  it("edits the profile, clears the plate with an empty string, and never touches status/location", async () => {
    await seedAdmin();
    const c = await customer();
    await createCourier(adminId, { userId: c._id.toString(), vehicleType: "car", plateNumber: "1" });
    await updateCourier(adminId, c._id.toString(), { vehicleType: "bicycle", plateNumber: "" });
    const dto = await getCourier(c._id.toString());
    expect(dto).toMatchObject({ vehicleType: "bicycle", plateNumber: null, availabilityStatus: "offline" });
    expect(await AuditLog.countDocuments({ action: "courier.updated" })).toBe(1);
  });
});

describe("setCourierActive (real MongoDB transactions)", () => {
  it("deactivates a courier with no active run, then reactivates; audits each change once", async () => {
    await seedAdmin();
    const c = await customer();
    await createCourier(adminId, { userId: c._id.toString(), vehicleType: "car" });
    expect((await setCourierActive(adminId, c._id.toString(), false)).isActive).toBe(false);
    expect((await setCourierActive(adminId, c._id.toString(), false)).isActive).toBe(false); // no-op
    expect((await setCourierActive(adminId, c._id.toString(), true)).isActive).toBe(true);
    expect(await AuditLog.countDocuments({ action: "courier.deactivated" })).toBe(1);
    expect(await AuditLog.countDocuments({ action: "courier.activated" })).toBe(1);
  });

  it("a DRAFT run does not block deactivation (only the canonical 'active' status does)", async () => {
    const { courierId } = await activeCourierWithDraft();
    expect((await setCourierActive(adminId, courierId, false)).isActive).toBe(false);
  });

  it("deactivation with an ACTIVE run → 409 and the write is rolled back (still active, no audit)", async () => {
    const { courierId, runId } = await activeCourierWithDraft();
    await activateRun(admin, runId);
    await expect(setCourierActive(adminId, courierId, false)).rejects.toMatchObject({ status: 409, code: "COURIER_HAS_ACTIVE_RUN" });
    expect((await User.findById(courierId).lean())?.isActive).toBe(true);
    expect(await AuditLog.countDocuments({ action: "courier.deactivated" })).toBe(0);
  });

  it("a deactivated courier cannot activate a run, and no order is assigned", async () => {
    const { courierId, runId } = await activeCourierWithDraft();
    await setCourierActive(adminId, courierId, false);
    await expect(activateRun(admin, runId)).rejects.toMatchObject({ status: 409, code: "COURIER_NOT_ACTIVE" });
    expect((await DeliveryRun.findById(runId).lean())?.status).toBe("draft");
    expect(await Order.countDocuments({ "delivery.status": "assigned" })).toBe(0);
  });

  it("race: deactivation vs run activation never leaves an INACTIVE courier with an ACTIVE run", async () => {
    for (let i = 0; i < 8; i += 1) {
      const { courierId, runId } = await activeCourierWithDraft();
      await Promise.allSettled([setCourierActive(adminId, courierId, false), activateRun(admin, runId)]);
      const user = await User.findById(courierId).lean();
      const run = await DeliveryRun.findById(runId).lean();
      expect(user?.isActive === false && run?.status === "active").toBe(false);
      await DeliveryRun.deleteMany({});
      await Order.deleteMany({});
      await User.deleteMany({ role: "courier" });
    }
  }, 120_000);
});
