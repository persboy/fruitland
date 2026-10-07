import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  find: vi.fn(),
  countDocuments: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  create: vi.fn(),
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("../models/DiscountCode", () => ({
  DiscountCode: { find: m.find, countDocuments: m.countDocuments, findOne: m.findOne, findOneAndUpdate: m.findOneAndUpdate, create: m.create },
}));
vi.mock("../models/User", () => ({ User: { find: m.userFind, findOne: m.userFindOne } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import {
  createDiscountCode,
  getDiscountCode,
  listDiscountCodes,
  setDiscountCodeActive,
  statusConditions,
  updateDiscountCode,
} from "./discountCodeService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const T0 = new Date("2026-01-01T10:00:00Z");
const code = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  code: "WELCOME10",
  type: "public",
  percentage: 10,
  minOrderAmount: 0,
  usedCount: 0,
  isActive: true,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});
const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, type: "all" as const, status: "all" as const, ...over });
const listChain = (docs: unknown[]) => {
  const chain = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), lean: () => Promise.resolve(docs) };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
};

beforeEach(() => {
  vi.resetAllMocks();
  m.auditCreate.mockResolvedValue({});
  m.userFind.mockReturnValue(lean([]));
});

describe("listDiscountCodes", () => {
  it("sorts newest first, paginates, returns metadata, and applies no condition for all/all/no search", async () => {
    const chain = listChain([code()]);
    m.find.mockReturnValue(chain);
    m.countDocuments.mockResolvedValue(45);
    const out = await listDiscountCodes(q({ page: 3, limit: 10 }));
    expect(m.find.mock.calls[0]![0]).toEqual({});
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(m.countDocuments).toHaveBeenCalledWith({});
    expect(out.pagination).toEqual({ page: 3, pageSize: 10, total: 45 });
  });

  it("uses an explicit projection (no __v, no unrelated fields)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listDiscountCodes(q());
    expect(Object.keys(m.find.mock.calls[0]![1] as object).sort()).toEqual(
      ["code", "createdAt", "expiresAt", "isActive", "maxDiscountAmount", "minOrderAmount", "ownerUserId", "percentage", "type", "updatedAt", "usageLimit", "usedCount"].sort(),
    );
  });

  it("type filter adds only a type condition", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listDiscountCodes(q({ type: "personal" }));
    expect(m.find.mock.calls[0]![0]).toEqual({ $and: [{ type: "personal" }] });
  });

  it("search matches the CODE only, as an escaped literal", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listDiscountCodes(q({ search: ".*(A+)+[X]$" }));
    const filter = m.find.mock.calls[0]![0] as { $and: { code: RegExp }[] };
    expect(filter.$and).toHaveLength(1);
    expect(Object.keys(filter.$and[0]!)).toEqual(["code"]);
    const rx = filter.$and[0]!.code;
    expect(rx.test(".*(A+)+[X]$")).toBe(true);
    expect(rx.test("ZZZ")).toBe(false); // metacharacters are not interpreted
    expect(rx.test("AAAA")).toBe(false);
    expect(m.countDocuments).toHaveBeenCalledWith(m.find.mock.calls[0]![0]);
  });

  it("search never touches owner, customer or User data", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listDiscountCodes(q({ search: "ALI" }));
    expect(m.userFind).not.toHaveBeenCalled();
    expect(JSON.stringify(m.find.mock.calls[0]![0])).not.toMatch(/phone|firstName|lastName|owner/);
  });

  it("combines type, search and status conditions with $and", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listDiscountCodes(q({ type: "public", search: "OFF", status: "disabled" }));
    const filter = m.find.mock.calls[0]![0] as { $and: unknown[] };
    expect(filter.$and).toHaveLength(4); // type, code, hasUsesLeft, isActive:false
  });

  it("filters status in MongoDB (never by fetching everything)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listDiscountCodes(q({ status: "exhausted" }));
    expect(m.find.mock.calls[0]![0]).toEqual({ $and: [{ usageLimit: { $type: "number" }, $expr: { $gte: ["$usedCount", "$usageLimit"] } }] });
    // paging happens in the database too
    const chain = listChain([]);
    m.find.mockReturnValue(chain);
    await listDiscountCodes(q({ status: "active", page: 2 }));
    expect(chain.skip).toHaveBeenCalledWith(20);
  });

  it("resolves owners with ONE User query limited to id/firstName/lastName/phone", async () => {
    const owner = { _id: new Types.ObjectId(), firstName: "علی", lastName: "رضایی", phone: "09120000001", passwordHash: "SECRET", courierProfile: { x: 1 } };
    m.find.mockReturnValue(listChain([code({ type: "personal", ownerUserId: owner._id }), code({ type: "personal", ownerUserId: owner._id }), code()]));
    m.countDocuments.mockResolvedValue(3);
    m.userFind.mockReturnValue(lean([owner]));
    const out = await listDiscountCodes(q());
    expect(m.userFind).toHaveBeenCalledTimes(1);
    expect(Object.keys(m.userFind.mock.calls[0]![1] as object).sort()).toEqual(["firstName", "lastName", "phone"]);
    expect(out.items[0]!.owner).toEqual({ id: owner._id.toString(), firstName: "علی", lastName: "رضایی", phone: "09120000001" });
    expect(out.items[2]!.owner).toBeNull(); // public
    expect(JSON.stringify(out)).not.toMatch(/passwordHash|SECRET|courierProfile/);
  });

  it("does not query users at all when there is no personal code", async () => {
    m.find.mockReturnValue(listChain([code()]));
    m.countDocuments.mockResolvedValue(1);
    await listDiscountCodes(q());
    expect(m.userFind).not.toHaveBeenCalled();
  });

  it("a personal code whose owner record is gone still renders (id only), never as public", async () => {
    const oid = new Types.ObjectId();
    m.find.mockReturnValue(listChain([code({ type: "personal", ownerUserId: oid })]));
    m.countDocuments.mockResolvedValue(1);
    const out = await listDiscountCodes(q());
    expect(out.items[0]!.owner).toEqual({ id: oid.toString(), firstName: null, lastName: null, phone: null });
  });
});

describe("DTO", () => {
  const dto = async (doc: Record<string, unknown>) => {
    m.findOne.mockReturnValue(lean(doc));
    return getDiscountCode(String(doc._id));
  };

  it("serialises field by field with defaults for absent optional fields", async () => {
    const d = await dto(code());
    expect(Object.keys(d).sort()).toEqual(
      ["code", "createdAt", "expiresAt", "id", "isActive", "maxDiscountAmount", "minOrderAmount", "owner", "percentage", "status", "type", "updatedAt", "usageLimit", "usedCount"].sort(),
    );
    expect(d).toMatchObject({ owner: null, maxDiscountAmount: null, usageLimit: null, expiresAt: null, minOrderAmount: 0, usedCount: 0, status: "active" });
  });

  it("never leaks Mongoose internals or unselected fields even if the driver returned them", async () => {
    const d = await dto(code({ __v: 3, secret: "x", ownerUserId: undefined }));
    expect(JSON.stringify(d)).not.toMatch(/__v|secret|_id/);
  });

  it("returns the expiry as an ISO instant", async () => {
    const d = await dto(code({ expiresAt: new Date("2026-10-07T20:29:59.999Z") }));
    expect(d.expiresAt).toBe("2026-10-07T20:29:59.999Z");
  });

  it.each([
    ["exhausted beats everything", { usageLimit: 2, usedCount: 2, isActive: false, expiresAt: new Date("2020-01-01") }, "exhausted"],
    ["disabled beats expired", { isActive: false, expiresAt: new Date("2020-01-01") }, "disabled"],
    ["expired", { expiresAt: new Date("2020-01-01") }, "expired"],
    ["active with a future expiry", { expiresAt: new Date("2999-01-01") }, "active"],
    ["unlimited stays active", { usedCount: 5000 }, "active"],
    ["not yet exhausted", { usageLimit: 3, usedCount: 2 }, "active"],
  ])("status: %s", async (_n, over, expected) => {
    expect((await dto(code(over))).status).toBe(expected);
  });

  it("a malformed or unknown id is a 404 DISCOUNT_CODE_NOT_FOUND and does not reach the database for a malformed one", async () => {
    await expect(getDiscountCode("not-an-id")).rejects.toMatchObject({ status: 404, code: "DISCOUNT_CODE_NOT_FOUND" });
    expect(m.findOne).not.toHaveBeenCalled();
    m.findOne.mockReturnValue(lean(null));
    await expect(getDiscountCode(new Types.ObjectId().toString())).rejects.toMatchObject({ status: 404, code: "DISCOUNT_CODE_NOT_FOUND" });
  });
});

describe("statusConditions mirror the status priority", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("all → no condition", () => expect(statusConditions("all", now)).toEqual([]));
  it("exhausted guards the comparison with $type number", () =>
    expect(statusConditions("exhausted", now)).toEqual([{ usageLimit: { $type: "number" }, $expr: { $gte: ["$usedCount", "$usageLimit"] } }]));
  it.each(["disabled", "expired", "active"] as const)("%s excludes exhausted codes first (priority)", (s) => {
    const first = statusConditions(s, now)[0] as { $or: unknown[] };
    expect(first.$or).toEqual([{ usageLimit: null }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }]);
  });
  it("disabled = isActive false", () => expect(statusConditions("disabled", now)[1]).toEqual({ isActive: false }));
  it("expired = active AND expiresAt strictly before now", () => {
    expect(statusConditions("expired", now).slice(1)).toEqual([{ isActive: true }, { expiresAt: { $lt: now } }]);
  });
  it("active = active AND (no expiry OR not yet passed)", () => {
    expect(statusConditions("active", now).slice(1)).toEqual([{ isActive: true }, { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] }]);
  });
});

describe("createDiscountCode", () => {
  const OWNER = new Types.ObjectId();
  const base = { code: "WELCOME10", type: "public" as const, percentage: 10 };
  const created = (over: Record<string, unknown> = {}) => {
    const doc = code(over);
    return { ...doc, toObject: () => doc };
  };

  it("creates a public code without touching User, using model defaults for usedCount/isActive", async () => {
    m.create.mockResolvedValue(created());
    const out = await createDiscountCode(actor, base);
    expect(m.userFindOne).not.toHaveBeenCalled();
    const arg = m.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toEqual({ code: "WELCOME10", type: "public", percentage: 10 });
    expect(arg).not.toHaveProperty("usedCount");
    expect(arg).not.toHaveProperty("isActive");
    expect(out).toMatchObject({ code: "WELCOME10", owner: null, usedCount: 0, isActive: true, status: "active" });
  });

  it("passes optional fields and converts the expiry day to the END of that day in Tehran", async () => {
    m.create.mockResolvedValue(created());
    await createDiscountCode(actor, { ...base, maxDiscountAmount: 50000, minOrderAmount: 100000, usageLimit: 5, expiresAt: "2026-10-07" });
    const arg = m.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({ maxDiscountAmount: 50000, minOrderAmount: 100000, usageLimit: 5 });
    expect((arg.expiresAt as Date).toISOString()).toBe("2026-10-07T20:29:59.999Z");
  });

  it("a personal code requires an active CUSTOMER owner — checked with role and isActive in the filter", async () => {
    m.userFindOne.mockReturnValue(lean({ _id: OWNER }));
    m.userFind.mockReturnValue(lean([{ _id: OWNER, firstName: "علی", lastName: "رضایی", phone: "0912" }]));
    m.create.mockResolvedValue(created({ type: "personal", ownerUserId: OWNER }));
    const out = await createDiscountCode(actor, { ...base, type: "personal", ownerUserId: OWNER.toString() });
    expect(m.userFindOne.mock.calls[0]![0]).toEqual({ _id: OWNER, role: "customer", isActive: true });
    expect((m.create.mock.calls[0]![0] as { ownerUserId: Types.ObjectId }).ownerUserId.toString()).toBe(OWNER.toString());
    expect(out.owner).toEqual({ id: OWNER.toString(), firstName: "علی", lastName: "رضایی", phone: "0912" });
  });

  it.each([
    ["an inactive customer / a non-customer / a missing user (all look the same)", null],
  ])("rejects %s with 400 DISCOUNT_CODE_OWNER_INVALID and never creates", async (_n, found) => {
    m.userFindOne.mockReturnValue(lean(found));
    await expect(createDiscountCode(actor, { ...base, type: "personal", ownerUserId: OWNER.toString() })).rejects.toMatchObject({
      status: 400,
      code: "DISCOUNT_CODE_OWNER_INVALID",
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a personal code without an owner id is rejected before any query", async () => {
    await expect(createDiscountCode(actor, { ...base, type: "personal" })).rejects.toMatchObject({ code: "DISCOUNT_CODE_OWNER_INVALID" });
    expect(m.userFindOne).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("a public code never stores an owner even if one slipped through", async () => {
    m.create.mockResolvedValue(created());
    await createDiscountCode(actor, { ...base, ownerUserId: OWNER.toString() });
    expect(m.create.mock.calls[0]![0]).not.toHaveProperty("ownerUserId");
    expect(m.userFindOne).not.toHaveBeenCalled();
  });

  it("maps a duplicate-key error (including a concurrent one) to 409 DISCOUNT_CODE_DUPLICATE with no audit", async () => {
    m.create.mockRejectedValue(Object.assign(new Error("E11000 duplicate key error collection: x index: code_1 dup key"), { code: 11000 }));
    const err = await createDiscountCode(actor, base).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: "DISCOUNT_CODE_DUPLICATE" });
    expect((err as Error).message).not.toMatch(/E11000|collection|index/);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("does not swallow unexpected errors", async () => {
    m.create.mockRejectedValue(new Error("boom"));
    await expect(createDiscountCode(actor, base)).rejects.toThrow("boom");
  });

  it("audits discount_code.created with before:null and a safe snapshot (owner id only)", async () => {
    m.userFindOne.mockReturnValue(lean({ _id: OWNER }));
    m.userFind.mockReturnValue(lean([{ _id: OWNER, phone: "0912" }]));
    m.create.mockResolvedValue(created({ type: "personal", ownerUserId: OWNER, usageLimit: 3 }));
    await createDiscountCode(actor, { ...base, type: "personal", ownerUserId: OWNER.toString(), usageLimit: 3 });
    const a = m.auditCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(a).toMatchObject({ actorUserId: actor, action: "discount_code.created", entityType: "DiscountCode", before: null });
    expect(a.after).toMatchObject({ code: "WELCOME10", type: "personal", ownerUserId: OWNER.toString(), percentage: 10, usageLimit: 3, isActive: true });
    expect(JSON.stringify(a)).not.toMatch(/phone|firstName|lastName/);
  });
});

describe("updateDiscountCode", () => {
  const id = new Types.ObjectId();
  const sid = id.toString();
  const current = (over: Record<string, unknown> = {}) => code({ _id: id, ...over });
  const mockCurrent = (doc: unknown) => m.findOne.mockReturnValueOnce(lean(doc));
  const after = (doc: unknown) => m.findOne.mockReturnValue(lean(doc)); // the final re-read

  it("404 for a malformed id without touching the database", async () => {
    await expect(updateDiscountCode(actor, "nope", { percentage: 5 })).rejects.toMatchObject({ status: 404 });
    expect(m.findOne).not.toHaveBeenCalled();
  });

  it("404 for an unknown id", async () => {
    mockCurrent(null);
    await expect(updateDiscountCode(actor, sid, { percentage: 5 })).rejects.toMatchObject({ code: "DISCOUNT_CODE_NOT_FOUND" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("writes only editable fields — never code, type, ownerUserId, usedCount or isActive", async () => {
    mockCurrent(current());
    m.findOneAndUpdate.mockReturnValue(lean(current()));
    after(current({ percentage: 20, maxDiscountAmount: 1000, minOrderAmount: 500, usageLimit: 9 }));
    await updateDiscountCode(actor, sid, { percentage: 20, maxDiscountAmount: 1000, minOrderAmount: 500, usageLimit: 9, expiresAt: "2026-10-07" });
    const update = m.findOneAndUpdate.mock.calls[0]![1] as { $set: Record<string, unknown> };
    expect(Object.keys(update.$set).sort()).toEqual(["expiresAt", "maxDiscountAmount", "minOrderAmount", "percentage", "usageLimit"]);
    expect((update.$set.expiresAt as Date).toISOString()).toBe("2026-10-07T20:29:59.999Z");
    for (const forbidden of ["code", "type", "ownerUserId", "usedCount", "isActive"]) expect(update.$set).not.toHaveProperty(forbidden);
    expect(m.findOneAndUpdate.mock.calls[0]![2]).toMatchObject({ new: false, runValidators: true });
  });

  it("null clears maxDiscountAmount, usageLimit and expiresAt with $unset", async () => {
    mockCurrent(current({ maxDiscountAmount: 100, usageLimit: 5, expiresAt: new Date("2026-12-01") }));
    m.findOneAndUpdate.mockReturnValue(lean(current({ maxDiscountAmount: 100, usageLimit: 5, expiresAt: new Date("2026-12-01") })));
    after(current());
    await updateDiscountCode(actor, sid, { maxDiscountAmount: null, usageLimit: null, expiresAt: null });
    const update = m.findOneAndUpdate.mock.calls[0]![1] as Record<string, Record<string, unknown>>;
    expect(update.$unset).toEqual({ maxDiscountAmount: 1, usageLimit: 1, expiresAt: 1 });
    expect(update.$set).toBeUndefined();
    // clearing the limit has no usedCount guard (unlimited is always >= usedCount)
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: id });
  });

  it("an unchanged request writes nothing and audits nothing", async () => {
    const same = current({ percentage: 10, minOrderAmount: 0, maxDiscountAmount: 500, usageLimit: 5, expiresAt: new Date("2026-10-07T20:29:59.999Z") });
    mockCurrent(same);
    after(same);
    await updateDiscountCode(actor, sid, { percentage: 10, minOrderAmount: 0, maxDiscountAmount: 500, usageLimit: 5, expiresAt: "2026-10-07" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("clearing a field that is already empty is a no-op", async () => {
    mockCurrent(current());
    after(current());
    await updateDiscountCode(actor, sid, { maxDiscountAmount: null, usageLimit: null, expiresAt: null });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  describe("usageLimit never below usedCount", () => {
    it("rejects a lower limit up front with 409 and never writes", async () => {
      mockCurrent(current({ usedCount: 5, usageLimit: 10 }));
      await expect(updateDiscountCode(actor, sid, { usageLimit: 4 })).rejects.toMatchObject({ status: 409, code: "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED" });
      expect(m.findOneAndUpdate).not.toHaveBeenCalled();
      expect(m.auditCreate).not.toHaveBeenCalled();
    });

    it("also applies when the code was unlimited before", async () => {
      mockCurrent(current({ usedCount: 5 }));
      await expect(updateDiscountCode(actor, sid, { usageLimit: 3 })).rejects.toMatchObject({ code: "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED" });
    });

    it("allows a limit equal to usedCount (the code becomes exhausted)", async () => {
      mockCurrent(current({ usedCount: 5, usageLimit: 10 }));
      m.findOneAndUpdate.mockReturnValue(lean(current({ usedCount: 5, usageLimit: 10 })));
      after(current({ usedCount: 5, usageLimit: 5 }));
      const out = await updateDiscountCode(actor, sid, { usageLimit: 5 });
      expect(out.status).toBe("exhausted");
    });

    it("the guard is part of the SAME conditional update (atomic), not only a prior read", async () => {
      mockCurrent(current({ usedCount: 2, usageLimit: 10 }));
      m.findOneAndUpdate.mockReturnValue(lean(current({ usedCount: 2, usageLimit: 10 })));
      after(current({ usedCount: 2, usageLimit: 3 }));
      await updateDiscountCode(actor, sid, { usageLimit: 3 });
      expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: id, usedCount: { $lte: 3 } });
    });

    it("if a concurrent usage increase wins the race, the conditional write misses and the result is a 409 (not a silent success)", async () => {
      mockCurrent(current({ usedCount: 2, usageLimit: 10 }));
      m.findOneAndUpdate.mockReturnValue(lean(null)); // usedCount became 4 between read and write
      m.findOne.mockReturnValueOnce(lean({ _id: id })); // the document still exists
      await expect(updateDiscountCode(actor, sid, { usageLimit: 3 })).rejects.toMatchObject({ status: 409, code: "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED" });
      expect(m.auditCreate).not.toHaveBeenCalled();
    });

    it("if the document vanished mid-update the answer is 404, not 409", async () => {
      mockCurrent(current({ usedCount: 2, usageLimit: 10 }));
      m.findOneAndUpdate.mockReturnValue(lean(null));
      m.findOne.mockReturnValueOnce(lean(null));
      await expect(updateDiscountCode(actor, sid, { usageLimit: 3 })).rejects.toMatchObject({ status: 404 });
    });

    it("a limit that does not change adds no guard", async () => {
      mockCurrent(current({ usedCount: 2, usageLimit: 10 }));
      m.findOneAndUpdate.mockReturnValue(lean(current()));
      after(current({ percentage: 30, usageLimit: 10 }));
      await updateDiscountCode(actor, sid, { percentage: 30, usageLimit: 10 });
      expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: id });
    });
  });

  it("audits discount_code.updated with before/after of the editable fields only (no owner/customer data)", async () => {
    const before = current({ percentage: 10, maxDiscountAmount: 100, usageLimit: 5, expiresAt: new Date("2026-12-01T00:00:00Z"), type: "personal", ownerUserId: new Types.ObjectId() });
    mockCurrent(before);
    m.findOneAndUpdate.mockReturnValue(lean(before));
    after(current({ percentage: 25, usageLimit: 5 }));
    await updateDiscountCode(actor, sid, { percentage: 25, maxDiscountAmount: null, expiresAt: "2026-10-07" });
    const a = m.auditCreate.mock.calls[0]![0] as { before: Record<string, unknown>; after: Record<string, unknown> } & Record<string, unknown>;
    expect(a).toMatchObject({ actorUserId: actor, action: "discount_code.updated", entityType: "DiscountCode", entityId: id });
    expect(a.before).toEqual({ percentage: 10, maxDiscountAmount: 100, minOrderAmount: 0, usageLimit: 5, expiresAt: "2026-12-01T00:00:00.000Z" });
    expect(a.after).toEqual({ percentage: 25, maxDiscountAmount: null, minOrderAmount: 0, usageLimit: 5, expiresAt: "2026-10-07T20:29:59.999Z" });
    expect(JSON.stringify(a)).not.toMatch(/ownerUserId|phone|firstName|code\b.*WELCOME/);
  });

  it("the audit 'before' comes from the atomic update result, not from the earlier read", async () => {
    mockCurrent(current({ percentage: 10 }));
    m.findOneAndUpdate.mockReturnValue(lean(current({ percentage: 15 }))); // someone else changed it in between
    after(current({ percentage: 40 }));
    await updateDiscountCode(actor, sid, { percentage: 40 });
    expect((m.auditCreate.mock.calls[0]![0] as { before: { percentage: number } }).before.percentage).toBe(15);
  });

  it("an owner-less code can be edited without any User lookup", async () => {
    mockCurrent(current());
    m.findOneAndUpdate.mockReturnValue(lean(current()));
    after(current({ percentage: 11 }));
    await updateDiscountCode(actor, sid, { percentage: 11 });
    expect(m.userFindOne).not.toHaveBeenCalled();
  });
});

describe("setDiscountCodeActive", () => {
  const id = new Types.ObjectId();
  const sid = id.toString();

  it("404 for malformed and unknown ids", async () => {
    await expect(setDiscountCodeActive(actor, "x", false)).rejects.toMatchObject({ status: 404 });
    m.findOne.mockReturnValueOnce(lean(null));
    await expect(setDiscountCodeActive(actor, sid, false)).rejects.toMatchObject({ code: "DISCOUNT_CODE_NOT_FOUND" });
  });

  it("deactivates with a write conditional on the state seen, audits, and changes only isActive", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, isActive: true }));
    m.findOne.mockReturnValue(lean(code({ _id: id, isActive: false })));
    const out = await setDiscountCodeActive(actor, sid, false);
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: id, isActive: true });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $set: { isActive: false } });
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor,
      action: "discount_code.deactivated",
      entityType: "DiscountCode",
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });
    expect(out.status).toBe("disabled");
  });

  it("activates and audits discount_code.activated", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: false }));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, isActive: false }));
    m.findOne.mockReturnValue(lean(code({ _id: id, isActive: true })));
    await setDiscountCodeActive(actor, sid, true);
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ action: "discount_code.activated", before: { isActive: false }, after: { isActive: true } });
  });

  it("requesting the state it already has is a successful no-op: no write, no audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true }));
    m.findOne.mockReturnValue(lean(code({ _id: id })));
    await setDiscountCodeActive(actor, sid, true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("a racing request that already flipped the state: the conditional write misses, so no second audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    m.findOne.mockReturnValue(lean(code({ _id: id, isActive: false })));
    const out = await setDiscountCodeActive(actor, sid, false);
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(out.isActive).toBe(false);
  });

  it("never touches usage, owner, expiry, values, orders or customers", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true }));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, isActive: true }));
    m.findOne.mockReturnValue(lean(code({ _id: id, isActive: false })));
    await setDiscountCodeActive(actor, sid, false);
    expect(Object.keys((m.findOneAndUpdate.mock.calls[0]![1] as { $set: object }).$set)).toEqual(["isActive"]);
    expect(m.userFind).not.toHaveBeenCalled();
    expect(m.userFindOne).not.toHaveBeenCalled();
  });
});

describe("module surface", () => {
  it("exposes no delete, redeem, release or reset operation", async () => {
    const mod = await import("./discountCodeService");
    expect(Object.keys(mod).sort()).toEqual(["createDiscountCode", "getDiscountCode", "listDiscountCodes", "setDiscountCodeActive", "statusConditions", "updateDiscountCode"]);
  });
});
