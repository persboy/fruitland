import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), auditCreate: vi.fn(), runExists: vi.fn(), startSession: vi.fn(),
}));
vi.mock("../models/User", () => ({ User: { find: m.find, countDocuments: m.countDocuments, findOne: m.findOne, findOneAndUpdate: m.findOneAndUpdate } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));
vi.mock("../models/DeliveryRun", () => ({ DeliveryRun: { exists: (...a: unknown[]) => ({ session: () => m.runExists(...a) }) } }));
vi.mock("./deliveryRunService", () => ({ isTransactionsUnsupportedError: (e: { code?: number }) => e?.code === 20 }));
vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();
  return { ...actual, startSession: m.startSession };
});

import { createCourier, getCourier, listCouriers, setCourierActive, updateCourier } from "./courierService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const T0 = new Date("2026-01-01T10:00:00Z");
const courier = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), phone: "09120000001", firstName: "علی", lastName: "رضایی", isActive: true, createdAt: T0,
  courierProfile: { vehicleType: "car", plateNumber: "12ب345", status: "offline" }, ...over,
});
const candidate = (over: Record<string, unknown> = {}) => ({ _id: new Types.ObjectId(), role: "customer", isActive: true, firstName: "علی", lastName: "رضایی", ...over });
const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, status: "all" as const, ...over });
const listChain = (docs: unknown[]) => {
  const chain = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), lean: () => Promise.resolve(docs) };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
};
const fakeSession = () => ({ withTransaction: async (fn: () => Promise<void>) => fn(), endSession: vi.fn() });
const expectApp = (p: Promise<unknown>, code: string, status: number) => expect(p).rejects.toMatchObject({ name: "AppError", code, status });

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
});

describe("listCouriers / getCourier", () => {
  it("always filters role=courier, newest first, paginates", async () => {
    const chain = listChain([courier()]);
    m.find.mockReturnValue(chain);
    m.countDocuments.mockResolvedValue(45);
    const out = await listCouriers(q({ page: 3, limit: 10 }));
    expect(m.find.mock.calls[0]![0]).toEqual({ role: "courier" });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(out.pagination).toEqual({ page: 3, pageSize: 10, total: 45 });
  });

  it("projection is explicit and never selects location, addresses, codes or credentials", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCouriers(q());
    const projection = Object.keys(m.find.mock.calls[0]![1] as object).sort();
    expect(projection).toEqual(["courierProfile.plateNumber", "courierProfile.status", "courierProfile.vehicleType", "createdAt", "firstName", "isActive", "lastName", "phone"]);
    expect(projection.join()).not.toMatch(/currentLocation|addresses|customerCode|referral|password|token/i);
  });

  it.each([["active", true], ["inactive", false]])("status=%s filters isActive=%s and keeps role=courier", async (status, isActive) => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCouriers(q({ status }));
    expect(m.find.mock.calls[0]![0]).toEqual({ role: "courier", isActive });
  });

  it("search: each token must match phone OR firstName OR lastName; role stays outside; input is escaped", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCouriers(q({ search: "علی .* رضایی x" }));
    const filter = m.find.mock.calls[0]![0] as { role: string; $and: { $or: { [k: string]: RegExp }[] }[] };
    expect(filter.role).toBe("courier");
    expect(filter.$and).toHaveLength(3); // capped at 3 tokens
    for (const c of filter.$and) expect(c.$or.map((x) => Object.keys(x)[0])).toEqual(["phone", "firstName", "lastName"]);
    expect(filter.$and[1]!.$or[0]!.phone!.test("abc")).toBe(false); // ".*" is a literal
  });

  it("the DTO has only the approved fields (no location, addresses, codes, credentials)", async () => {
    const dirty = courier({
      addresses: [{}], customerCode: "12345", referralCode: "X", passwordHash: "h", refreshTokens: ["t"],
      courierProfile: { vehicleType: "car", status: "busy", currentLocation: { lat: 1, lng: 2 } },
    });
    m.findOne.mockReturnValue(lean(dirty));
    const dto = await getCourier(dirty._id.toString());
    expect(Object.keys(dto).sort()).toEqual(["availabilityStatus", "createdAt", "firstName", "id", "isActive", "lastName", "phone", "plateNumber", "vehicleType"]);
    expect(dto).toMatchObject({ vehicleType: "car", plateNumber: null, availabilityStatus: "busy", createdAt: T0.toISOString() });
    expect(JSON.stringify(dto)).not.toMatch(/currentLocation|"lat"|"lng"|12345|passwordHash|customerCode/);
  });

  it("a malformed id and a non-courier id are both 404 COURIER_NOT_FOUND", async () => {
    await expectApp(getCourier("nope"), "COURIER_NOT_FOUND", 404);
    m.findOne.mockReturnValue(lean(null));
    await expectApp(getCourier(new Types.ObjectId().toString()), "COURIER_NOT_FOUND", 404);
    expect(m.findOne.mock.calls[0]![0]).toMatchObject({ role: "courier" });
  });
});

describe("createCourier — promotion of an existing customer", () => {
  const input = (userId: string, over: Record<string, unknown> = {}) => ({ userId, vehicleType: "motorcycle" as const, ...over });

  function arrangeSuccess(c = candidate()) {
    m.findOne
      .mockReturnValueOnce(lean(c)) // eligibility read
      .mockReturnValueOnce(lean(courier({ _id: c._id, courierProfile: { vehicleType: "motorcycle", status: "offline" } }))); // getCourier
    m.findOneAndUpdate.mockReturnValue(lean({ role: "customer" }));
    return c;
  }

  it("promotes with ONE conditional write (customer + active + non-empty names in the filter) and initial offline profile", async () => {
    const c = arrangeSuccess();
    const dto = await createCourier(actor, input(c._id.toString(), { plateNumber: "12ب345" }));
    const [filter, update, options] = m.findOneAndUpdate.mock.calls[0]!;
    expect(filter).toMatchObject({ _id: c._id, role: "customer", isActive: true, firstName: { $type: "string", $ne: "" }, lastName: { $type: "string", $ne: "" } });
    expect(update).toEqual({ $set: { role: "courier", courierProfile: { vehicleType: "motorcycle", status: "offline", plateNumber: "12ب345" } } });
    expect(options).toMatchObject({ new: false, runValidators: true });
    expect(dto.vehicleType).toBe("motorcycle");
  });

  it("plateNumber is optional: omitted from the profile", async () => {
    const c = arrangeSuccess();
    await createCourier(actor, input(c._id.toString()));
    expect(m.findOneAndUpdate.mock.calls[0]![1].$set.courierProfile).toEqual({ vehicleType: "motorcycle", status: "offline" });
  });

  it("audits courier.created exactly once, without PII beyond the role/vehicle/plate", async () => {
    const c = arrangeSuccess();
    await createCourier(actor, input(c._id.toString(), { plateNumber: "9" }));
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate.mock.calls[0]![0]).toEqual({
      actorUserId: actor, action: "courier.created", entityType: "User", entityId: c._id,
      before: { role: "customer" }, after: { role: "courier", vehicleType: "motorcycle", plateNumber: "9" },
    });
  });

  it.each([
    ["missing user", null, "COURIER_CANDIDATE_NOT_FOUND", 404],
    ["already a courier", candidate({ role: "courier" }), "USER_ALREADY_COURIER", 409],
    ["admin", candidate({ role: "admin" }), "COURIER_CANDIDATE_NOT_CUSTOMER", 400],
    ["master admin", candidate({ role: "master_admin" }), "COURIER_CANDIDATE_NOT_CUSTOMER", 400],
    ["inactive customer", candidate({ isActive: false }), "COURIER_CANDIDATE_INACTIVE", 400],
    ["missing first name", candidate({ firstName: undefined }), "COURIER_CANDIDATE_PROFILE_INCOMPLETE", 400],
    ["blank last name", candidate({ lastName: "  " }), "COURIER_CANDIDATE_PROFILE_INCOMPLETE", 400],
    ["invalid name chars", candidate({ firstName: "<b>" }), "COURIER_CANDIDATE_PROFILE_INCOMPLETE", 400],
  ])("rejects %s with a specific safe error and writes/audits nothing", async (_n, doc, code, status) => {
    m.findOne.mockReturnValue(lean(doc));
    await expectApp(createCourier(actor, input(new Types.ObjectId().toString())), code, status);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a malformed userId is COURIER_CANDIDATE_NOT_FOUND without touching the database", async () => {
    await expectApp(createCourier(actor, input("zzz")), "COURIER_CANDIDATE_NOT_FOUND", 404);
    expect(m.findOne).not.toHaveBeenCalled();
  });

  it("concurrent promotion: the loser's conditional write matches nothing → re-classified as USER_ALREADY_COURIER, no audit", async () => {
    const c = candidate();
    m.findOne.mockReturnValueOnce(lean(c)).mockReturnValueOnce(lean({ ...c, role: "courier" }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expectApp(createCourier(actor, input(c._id.toString())), "USER_ALREADY_COURIER", 409);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a concurrent role change to admin between read and write cannot be overwritten (filter requires customer; loser gets a safe 400)", async () => {
    const c = candidate();
    m.findOne.mockReturnValueOnce(lean(c)).mockReturnValueOnce(lean({ ...c, role: "admin" }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expectApp(createCourier(actor, input(c._id.toString())), "COURIER_CANDIDATE_NOT_CUSTOMER", 400);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("an unexplained lost race degrades to 409 COURIER_PROMOTION_CONFLICT", async () => {
    const c = candidate();
    m.findOne.mockReturnValue(lean(c));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expectApp(createCourier(actor, input(c._id.toString())), "COURIER_PROMOTION_CONFLICT", 409);
  });
});

describe("updateCourier", () => {
  it("updates vehicleType/plateNumber on role=courier only and audits before/after", async () => {
    const c = courier();
    m.findOne.mockReturnValueOnce(lean(c)).mockReturnValueOnce(lean(c));
    m.findOneAndUpdate.mockReturnValue(lean(c));
    await updateCourier(actor, c._id.toString(), { vehicleType: "bicycle", plateNumber: "77" });
    const [filter, update] = m.findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: c._id, role: "courier" });
    expect(update).toEqual({ $set: { "courierProfile.vehicleType": "bicycle", "courierProfile.plateNumber": "77" } });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({
      action: "courier.updated", before: { vehicleType: "car", plateNumber: "12ب345" }, after: { vehicleType: "bicycle", plateNumber: "77" },
    });
  });

  it('plateNumber "" clears the plate with $unset', async () => {
    const c = courier();
    m.findOne.mockReturnValue(lean(c));
    m.findOneAndUpdate.mockReturnValue(lean(c));
    await updateCourier(actor, c._id.toString(), { plateNumber: "" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $unset: { "courierProfile.plateNumber": 1 } });
    expect(m.auditCreate.mock.calls[0]![0].after).toEqual({ vehicleType: "car", plateNumber: null });
  });

  it("an unchanged request is a no-op: no write, no audit", async () => {
    const c = courier();
    m.findOne.mockReturnValue(lean(c));
    await updateCourier(actor, c._id.toString(), { vehicleType: "car", plateNumber: "12ب345" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("missing / non-courier / lost-before-write → 404 and no audit", async () => {
    m.findOne.mockReturnValueOnce(lean(null));
    await expectApp(updateCourier(actor, new Types.ObjectId().toString(), { vehicleType: "car" }), "COURIER_NOT_FOUND", 404);
    const c = courier();
    m.findOne.mockReturnValueOnce(lean(c));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expectApp(updateCourier(actor, c._id.toString(), { vehicleType: "bicycle" }), "COURIER_NOT_FOUND", 404);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("setCourierActive", () => {
  it("activation: conditional isActive false→true write + courier.activated audit, no transaction", async () => {
    const c = courier({ isActive: false });
    m.findOne.mockReturnValueOnce(lean({ isActive: false })).mockReturnValueOnce(lean({ ...c, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean({ isActive: false }));
    const dto = await setCourierActive(actor, c._id.toString(), true);
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: c._id, role: "courier", isActive: false });
    expect(m.startSession).not.toHaveBeenCalled();
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "courier.activated", before: { isActive: false }, after: { isActive: true } });
    expect(dto.isActive).toBe(true);
  });

  it("the state it already has is a successful no-op without write or audit", async () => {
    const c = courier();
    m.findOne.mockReturnValue(lean({ ...c }));
    await setCourierActive(actor, c._id.toString(), true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.startSession).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("deactivation without an active run: ONE transaction — conditional write, run check in the same session using the canonical 'active' status, audit in the session", async () => {
    const c = courier();
    const session = fakeSession();
    m.startSession.mockResolvedValue(session);
    m.findOne.mockReturnValueOnce(lean({ isActive: true })).mockReturnValueOnce(lean({ ...c, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean({ isActive: true }));
    m.runExists.mockResolvedValue(null);
    const dto = await setCourierActive(actor, c._id.toString(), false);
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: c._id, role: "courier", isActive: true });
    expect(m.findOneAndUpdate.mock.calls[0]![2]).toHaveProperty("session", session);
    expect(m.runExists).toHaveBeenCalledWith({ courierId: c._id, status: "active" });
    const [auditDocs, auditOpts] = m.auditCreate.mock.calls[0]!;
    expect(auditDocs[0]).toMatchObject({ action: "courier.deactivated", before: { isActive: true }, after: { isActive: false } });
    expect(auditOpts).toEqual({ session });
    expect(session.endSession).toHaveBeenCalled();
    expect(dto.isActive).toBe(false);
  });

  it("deactivation with an active run → 409 COURIER_HAS_ACTIVE_RUN, the transaction aborts and NO audit is written", async () => {
    const c = courier();
    const session = fakeSession();
    m.startSession.mockResolvedValue(session);
    m.findOne.mockReturnValue(lean({ isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean({ isActive: true }));
    m.runExists.mockResolvedValue({ _id: new Types.ObjectId() });
    await expectApp(setCourierActive(actor, c._id.toString(), false), "COURIER_HAS_ACTIVE_RUN", 409);
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it("a racing deactivation that already won: nothing is audited and the run check is skipped", async () => {
    const c = courier({ isActive: false });
    m.startSession.mockResolvedValue(fakeSession());
    m.findOne.mockReturnValueOnce(lean({ isActive: true })).mockReturnValueOnce(lean(c));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await setCourierActive(actor, c._id.toString(), false);
    expect(m.runExists).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a standalone mongod (no transactions) is a plain Error (logged 500), never an unsafe non-transactional fallback", async () => {
    m.startSession.mockResolvedValue({ withTransaction: async () => { throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 }); }, endSession: vi.fn() });
    m.findOne.mockReturnValue(lean({ isActive: true }));
    const err = await setCourierActive(actor, new Types.ObjectId().toString(), false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { name: string }).name).not.toBe("AppError");
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("missing / non-courier → 404", async () => {
    m.findOne.mockReturnValue(lean(null));
    await expectApp(setCourierActive(actor, new Types.ObjectId().toString(), true), "COURIER_NOT_FOUND", 404);
  });
});
