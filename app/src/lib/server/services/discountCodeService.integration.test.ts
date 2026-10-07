import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { computeDiscountCodeStatus, type DiscountCodeStatus } from "@fruitland/shared";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { AuditLog } from "../models/AuditLog";
import { DiscountCode } from "../models/DiscountCode";
import { User } from "../models/User";
import {
  createDiscountCode,
  getDiscountCode,
  listDiscountCodes,
  setDiscountCodeActive,
  updateDiscountCode,
} from "./discountCodeService";

/**
 * Real-MongoDB tests for the Discount Codes admin service (a standalone mongod is enough — every
 * write here is a single-document atomic operation). Run with `npm run test:integration`.
 */
describe("discount codes (integration, real MongoDB)", () => {
  const actor = new Types.ObjectId().toString();
  let n = 0;
  const customer = (over: Record<string, unknown> = {}) => User.create({ phone: `0912000${String(++n).padStart(4, "0")}`, role: "customer", firstName: "علی", lastName: "رضایی", ...over });
  const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, type: "all" as const, status: "all" as const, ...over });
  const base = (code: string, over: Record<string, unknown> = {}) => ({ code, type: "public" as const, percentage: 10, ...over });

  beforeAll(async () => {
    await startTestDb();
    await DiscountCode.init(); // build the unique index before any write
    await User.init();
  }, 120_000);
  afterAll(stopTestDb);
  afterEach(clearTestDb);

  it("has the unique code index and no speculative extra indexes", async () => {
    const indexes = await DiscountCode.collection.indexes();
    const unique = indexes.find((i) => i.key.code === 1);
    expect(unique?.unique).toBe(true);
    expect(indexes.map((i) => Object.keys(i.key).join(","))).toEqual(["_id", "code"]);
  });

  it("the unique index is the final authority: a duplicate code (any case) is a 409 and writes no audit", async () => {
    await createDiscountCode(actor, { code: "WELCOME10", type: "public", percentage: 10 });
    await expect(createDiscountCode(actor, { code: "WELCOME10", type: "public", percentage: 20 })).rejects.toMatchObject({ status: 409, code: "DISCOUNT_CODE_DUPLICATE" });
    expect(await DiscountCode.countDocuments()).toBe(1);
    expect(await AuditLog.countDocuments({ action: "discount_code.created" })).toBe(1);
  });

  it("two concurrent creates of the same code: exactly one wins, the other is a 409", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createDiscountCode(actor, { code: "RACE", type: "public", percentage: 10 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "DISCOUNT_CODE_DUPLICATE" });
    expect(await DiscountCode.countDocuments({ code: "RACE" })).toBe(1);
  });

  it("creates public and personal codes with the model defaults, and rejects non-customer / inactive owners", async () => {
    const pub = await createDiscountCode(actor, { code: "PUB", type: "public", percentage: 10 });
    expect(pub).toMatchObject({ owner: null, usedCount: 0, isActive: true, status: "active", minOrderAmount: 0, usageLimit: null, maxDiscountAmount: null, expiresAt: null });

    const owner = await customer();
    const per = await createDiscountCode(actor, { code: "PER", type: "personal", ownerUserId: owner._id.toString(), percentage: 15 });
    expect(per.owner).toEqual({ id: owner._id.toString(), firstName: "علی", lastName: "رضایی", phone: owner.phone });

    const inactive = await customer({ isActive: false });
    const courier = await customer({ role: "courier" });
    const admin = await customer({ role: "admin" });
    for (const u of [inactive, courier, admin, { _id: new Types.ObjectId() }]) {
      await expect(createDiscountCode(actor, { code: `X${++n}`, type: "personal", ownerUserId: u._id.toString(), percentage: 5 })).rejects.toMatchObject({ code: "DISCOUNT_CODE_OWNER_INVALID" });
    }
    expect(await DiscountCode.countDocuments()).toBe(2);
  });

  it("stores the expiry as the end of the chosen day in Tehran", async () => {
    const c = await createDiscountCode(actor, { code: "EXP", type: "public", percentage: 10, expiresAt: "2026-10-07" });
    expect(c.expiresAt).toBe("2026-10-07T20:29:59.999Z");
    expect((await DiscountCode.findOne({ code: "EXP" }).lean())?.expiresAt?.toISOString()).toBe("2026-10-07T20:29:59.999Z");
  });

  it("orders newest first and paginates for real (no overlap, correct totals, out-of-range page is empty)", async () => {
    for (let i = 0; i < 5; i++) {
      await DiscountCode.create(base(`CODE${i}`));
      await new Promise((r) => setTimeout(r, 5));
    }
    const p1 = await listDiscountCodes(q({ limit: 2, page: 1 }));
    const p2 = await listDiscountCodes(q({ limit: 2, page: 2 }));
    const p3 = await listDiscountCodes(q({ limit: 2, page: 3 }));
    const p4 = await listDiscountCodes(q({ limit: 2, page: 4 }));
    expect([...p1.items, ...p2.items, ...p3.items].map((c) => c.code)).toEqual(["CODE4", "CODE3", "CODE2", "CODE1", "CODE0"]);
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 5 });
    expect(p4.items).toEqual([]);
    expect(p4.pagination.total).toBe(5);
  });

  it("search matches the code only, treating metacharacters literally", async () => {
    const owner = await customer({ firstName: "SAMPLE" });
    await DiscountCode.create(base("SUMMER-10"));
    await DiscountCode.create(base("WINTER_20"));
    await DiscountCode.create({ code: "PERSONAL1", type: "personal", ownerUserId: owner._id, percentage: 5 });
    expect((await listDiscountCodes(q({ search: "SUMMER" }))).items.map((c) => c.code)).toEqual(["SUMMER-10"]);
    expect((await listDiscountCodes(q({ search: "-" }))).items.map((c) => c.code)).toEqual(["SUMMER-10"]);
    expect((await listDiscountCodes(q({ search: "." }))).items).toEqual([]);
    expect((await listDiscountCodes(q({ search: ".*" }))).items).toEqual([]);
    expect((await listDiscountCodes(q({ search: "SAMPLE" }))).items).toEqual([]); // owner name is not searched
    expect((await listDiscountCodes(q({ search: owner.phone! }))).items).toEqual([]); // nor owner phone
    expect((await listDiscountCodes(q({ search: "(" }))).items).toEqual([]);
  });

  it("filters by type", async () => {
    const owner = await customer();
    await DiscountCode.create(base("PUB1"));
    await DiscountCode.create({ code: "PER1", type: "personal", ownerUserId: owner._id, percentage: 5 });
    expect((await listDiscountCodes(q({ type: "public" }))).items.map((c) => c.code)).toEqual(["PUB1"]);
    expect((await listDiscountCodes(q({ type: "personal" }))).items.map((c) => c.code)).toEqual(["PER1"]);
    expect((await listDiscountCodes(q({ type: "all" }))).pagination.total).toBe(2);
  });

  describe("status filter (computed in MongoDB, priority exhausted > disabled > expired > active)", () => {
    const PAST = new Date("2020-01-01T00:00:00Z");
    const FUTURE = new Date("2999-01-01T00:00:00Z");
    // every combination of the four inputs that decide a status
    const seed = async () => {
      const combos: { code: string; isActive: boolean; usageLimit?: number; usedCount: number; expiresAt?: Date }[] = [];
      let i = 0;
      for (const isActive of [true, false])
        for (const limit of [undefined, 3])
          for (const usedCount of [0, 2, 3, 5])
            for (const expiresAt of [undefined, PAST, FUTURE])
              combos.push({ code: `C${String(i++).padStart(3, "0")}`, isActive, usageLimit: limit, usedCount, expiresAt });
      for (const c of combos) await DiscountCode.collection.insertOne({ ...c, type: "public", percentage: 10, minOrderAmount: 0, createdAt: new Date(), updatedAt: new Date() });
      return combos;
    };

    it("every status filter returns exactly the codes the shared status function assigns to it (full matrix)", async () => {
      const combos = await seed();
      const expected = new Map<DiscountCodeStatus, string[]>();
      for (const c of combos) {
        const s = computeDiscountCodeStatus({ isActive: c.isActive, usedCount: c.usedCount, usageLimit: c.usageLimit ?? null, expiresAt: c.expiresAt ?? null });
        expected.set(s, [...(expected.get(s) ?? []), c.code]);
      }
      for (const status of ["active", "disabled", "exhausted", "expired"] as const) {
        const got = (await listDiscountCodes(q({ status, limit: 100 }))).items;
        expect(got.map((c) => c.code).sort()).toEqual((expected.get(status) ?? []).sort());
        expect(new Set(got.map((c) => c.status))).toEqual(new Set([status])); // DTO status agrees with the filter
      }
      // the four filters partition the whole set
      const total = (await Promise.all(["active", "disabled", "exhausted", "expired"].map((status) => listDiscountCodes(q({ status: status as DiscountCodeStatus, limit: 1 }))))).reduce(
        (sum, r) => sum + r.pagination.total,
        0,
      );
      expect(total).toBe(combos.length);
    });

    it("an unlimited code (no usageLimit) is never exhausted, however many uses it has", async () => {
      await DiscountCode.create(base("UNLIM", { usedCount: 99999 }));
      expect((await listDiscountCodes(q({ status: "exhausted" }))).items).toEqual([]);
      expect((await listDiscountCodes(q({ status: "active" }))).items.map((c) => c.code)).toEqual(["UNLIM"]);
    });

    it("exhausted beats disabled and expired; disabled beats expired", async () => {
      await DiscountCode.create(base("EXH", { usageLimit: 1, usedCount: 1, isActive: false, expiresAt: PAST }));
      await DiscountCode.create(base("DIS", { isActive: false, expiresAt: PAST }));
      await DiscountCode.create(base("EXP", { expiresAt: PAST }));
      expect((await listDiscountCodes(q({ status: "exhausted" }))).items.map((c) => c.code)).toEqual(["EXH"]);
      expect((await listDiscountCodes(q({ status: "disabled" }))).items.map((c) => c.code)).toEqual(["DIS"]);
      expect((await listDiscountCodes(q({ status: "expired" }))).items.map((c) => c.code)).toEqual(["EXP"]);
      expect((await listDiscountCodes(q({ status: "active" }))).items).toEqual([]);
    });

    it("expiry behaves on real timestamps: just-passed is expired, just-ahead is still active", async () => {
      await DiscountCode.create(base("PASSED", { expiresAt: new Date(Date.now() - 1000) }));
      await DiscountCode.create(base("AHEAD", { expiresAt: new Date(Date.now() + 60_000) }));
      expect((await listDiscountCodes(q({ status: "expired" }))).items.map((c) => c.code)).toEqual(["PASSED"]);
      expect((await listDiscountCodes(q({ status: "active" }))).items.map((c) => c.code)).toEqual(["AHEAD"]);
    });

    it("status, type and search combine, and pagination counts the filtered set", async () => {
      for (let i = 0; i < 5; i++) await DiscountCode.create(base(`OFF${i}`, { isActive: false }));
      await DiscountCode.create(base("OFFACTIVE"));
      await DiscountCode.create(base("OTHER", { isActive: false }));
      const r = await listDiscountCodes(q({ status: "disabled", type: "public", search: "OFF", limit: 2, page: 2 }));
      expect(r.pagination).toEqual({ page: 2, pageSize: 2, total: 5 });
      expect(r.items).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("edits only the editable fields and never touches code, type, owner, usedCount or isActive", async () => {
      const owner = await customer();
      const created = await createDiscountCode(actor, { code: "KEEP", type: "personal", ownerUserId: owner._id.toString(), percentage: 10 });
      await DiscountCode.updateOne({ code: "KEEP" }, { $set: { usedCount: 3 } });
      const updated = await updateDiscountCode(actor, created.id, { percentage: 40, maxDiscountAmount: 90000, minOrderAmount: 200000, usageLimit: 8, expiresAt: "2026-10-07" });
      expect(updated).toMatchObject({ code: "KEEP", type: "personal", usedCount: 3, isActive: true, percentage: 40, maxDiscountAmount: 90000, minOrderAmount: 200000, usageLimit: 8, expiresAt: "2026-10-07T20:29:59.999Z" });
      expect(updated.owner?.id).toBe(owner._id.toString());
    });

    it("null clears maxDiscountAmount, usageLimit and expiresAt for real ($unset)", async () => {
      const c = await createDiscountCode(actor, { code: "CLR", type: "public", percentage: 10, maxDiscountAmount: 5000, usageLimit: 4, expiresAt: "2026-10-07" });
      const out = await updateDiscountCode(actor, c.id, { maxDiscountAmount: null, usageLimit: null, expiresAt: null });
      expect(out).toMatchObject({ maxDiscountAmount: null, usageLimit: null, expiresAt: null });
      const raw = await DiscountCode.collection.findOne({ code: "CLR" });
      expect(raw).not.toHaveProperty("maxDiscountAmount");
      expect(raw).not.toHaveProperty("usageLimit");
      expect(raw).not.toHaveProperty("expiresAt");
    });

    it("usageLimit cannot go below usedCount (409), may equal it, may be cleared", async () => {
      const c = await createDiscountCode(actor, { code: "LIM", type: "public", percentage: 10, usageLimit: 10 });
      await DiscountCode.updateOne({ code: "LIM" }, { $set: { usedCount: 4 } });
      await expect(updateDiscountCode(actor, c.id, { usageLimit: 3 })).rejects.toMatchObject({ status: 409, code: "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED" });
      expect((await getDiscountCode(c.id)).usageLimit).toBe(10);
      expect((await updateDiscountCode(actor, c.id, { usageLimit: 4 })).status).toBe("exhausted");
      expect((await updateDiscountCode(actor, c.id, { usageLimit: null })).status).toBe("active");
      expect(await AuditLog.countDocuments({ action: "discount_code.updated" })).toBe(2); // the rejected attempt wrote nothing
    });

    it("an unlimited code cannot be given a limit below its usedCount either", async () => {
      const c = await createDiscountCode(actor, { code: "UNL", type: "public", percentage: 10 });
      await DiscountCode.updateOne({ code: "UNL" }, { $set: { usedCount: 7 } });
      await expect(updateDiscountCode(actor, c.id, { usageLimit: 5 })).rejects.toMatchObject({ code: "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED" });
    });

    it("concurrent usage increments racing a limit decrease can never leave usedCount above usageLimit", async () => {
      const c = await createDiscountCode(actor, { code: "RACELIM", type: "public", percentage: 10, usageLimit: 50 });
      const id = new Types.ObjectId(c.id);
      // The (future) redemption guard is `usedCount < usageLimit`; model that guard against the real limit updates.
      const redeem = () => DiscountCode.updateOne({ _id: id, $expr: { $lt: ["$usedCount", { $ifNull: ["$usageLimit", Infinity] }] } }, { $inc: { usedCount: 1 } });
      const lower = (n: number) => updateDiscountCode(actor, c.id, { usageLimit: n }).catch((e: unknown) => e);
      const ops = [...Array.from({ length: 40 }, redeem), lower(30), lower(20), lower(10), lower(5)];
      await Promise.all(ops);
      const final = await DiscountCode.collection.findOne({ _id: id });
      expect(final!.usedCount).toBeLessThanOrEqual(final!.usageLimit);
    });

    it("an unchanged request writes nothing and audits nothing", async () => {
      const c = await createDiscountCode(actor, { code: "NOOP", type: "public", percentage: 10, usageLimit: 5, expiresAt: "2026-10-07" });
      const before = await DiscountCode.collection.findOne({ code: "NOOP" });
      await updateDiscountCode(actor, c.id, { percentage: 10, usageLimit: 5, expiresAt: "2026-10-07", maxDiscountAmount: null });
      expect((await DiscountCode.collection.findOne({ code: "NOOP" }))!.updatedAt).toEqual(before!.updatedAt);
      expect(await AuditLog.countDocuments({ action: "discount_code.updated" })).toBe(0);
    });

    it("404 for an unknown or malformed id", async () => {
      await expect(updateDiscountCode(actor, new Types.ObjectId().toString(), { percentage: 5 })).rejects.toMatchObject({ status: 404 });
      await expect(updateDiscountCode(actor, "nope", { percentage: 5 })).rejects.toMatchObject({ status: 404 });
    });

    it("rejects model-invalid values at the database layer too (defense in depth)", async () => {
      const c = await createDiscountCode(actor, { code: "VAL", type: "public", percentage: 10 });
      // bypassing the shared schema on purpose
      await expect(updateDiscountCode(actor, c.id, { percentage: 10.5 })).rejects.toThrow();
      await expect(updateDiscountCode(actor, c.id, { percentage: 101 })).rejects.toThrow();
      expect((await getDiscountCode(c.id)).percentage).toBe(10);
    });

    it("writes before/after of the editable fields to the audit log", async () => {
      const c = await createDiscountCode(actor, { code: "AUD", type: "public", percentage: 10, usageLimit: 5 });
      await updateDiscountCode(actor, c.id, { percentage: 25, usageLimit: null });
      const log = await AuditLog.findOne({ action: "discount_code.updated" }).lean();
      expect(log).toMatchObject({ entityType: "DiscountCode", entityId: new Types.ObjectId(c.id) });
      expect(log!.before).toMatchObject({ percentage: 10, usageLimit: 5 });
      expect(log!.after).toMatchObject({ percentage: 25, usageLimit: null });
    });
  });

  describe("status mutation", () => {
    it("deactivates and reactivates with exactly one audit entry per real change, touching only isActive", async () => {
      const c = await createDiscountCode(actor, { code: "TOG", type: "public", percentage: 10, usageLimit: 3, expiresAt: "2026-10-07" });
      await DiscountCode.updateOne({ code: "TOG" }, { $set: { usedCount: 2 } });
      const raw = async () => DiscountCode.collection.findOne({ code: "TOG" });
      const before = await raw();
      expect((await setDiscountCodeActive(actor, c.id, false)).status).toBe("disabled");
      await setDiscountCodeActive(actor, c.id, false); // already inactive → no-op
      expect((await setDiscountCodeActive(actor, c.id, true)).status).toBe("active");
      await setDiscountCodeActive(actor, c.id, true); // already active → no-op
      const after = await raw();
      expect({ ...after, isActive: before!.isActive, updatedAt: before!.updatedAt }).toEqual(before);
      expect(await AuditLog.countDocuments({ action: "discount_code.deactivated" })).toBe(1);
      expect(await AuditLog.countDocuments({ action: "discount_code.activated" })).toBe(1);
    });

    it("racing identical requests produce a single audit entry (conditional update)", async () => {
      const c = await createDiscountCode(actor, { code: "RACE2", type: "public", percentage: 10 });
      await Promise.all(Array.from({ length: 8 }, () => setDiscountCodeActive(actor, c.id, false)));
      expect(await AuditLog.countDocuments({ action: "discount_code.deactivated" })).toBe(1);
      expect((await getDiscountCode(c.id)).isActive).toBe(false);
    });

    it("404 for an unknown id", async () => {
      await expect(setDiscountCodeActive(actor, new Types.ObjectId().toString(), true)).rejects.toMatchObject({ status: 404 });
    });
  });

  it("a deactivated customer does not change their personal code", async () => {
    const owner = await customer();
    const c = await createDiscountCode(actor, { code: "STAYS", type: "personal", ownerUserId: owner._id.toString(), percentage: 10 });
    await User.updateOne({ _id: owner._id }, { $set: { isActive: false } });
    const out = await getDiscountCode(c.id);
    expect(out).toMatchObject({ isActive: true, status: "active" });
    expect(out.owner?.id).toBe(owner._id.toString());
  });

  it("the owner object never carries more than id/firstName/lastName/phone", async () => {
    const owner = await customer({ passwordHash: "SECRET-HASH", courierProfile: { vehicle: "x" } });
    const c = await createDiscountCode(actor, { code: "SAFE", type: "personal", ownerUserId: owner._id.toString(), percentage: 10 });
    const out = await listDiscountCodes(q());
    expect(Object.keys(out.items[0]!.owner!).sort()).toEqual(["firstName", "id", "lastName", "phone"]);
    expect(JSON.stringify(out) + JSON.stringify(await getDiscountCode(c.id))).not.toMatch(/SECRET-HASH|courierProfile|vehicle|passwordHash/);
  });

  it("never writes Orders or users (only DiscountCode and AuditLog)", async () => {
    const owner = await customer();
    const usersBefore = await User.collection.findOne({ _id: owner._id });
    const c = await createDiscountCode(actor, { code: "SCOPE", type: "personal", ownerUserId: owner._id.toString(), percentage: 10 });
    await updateDiscountCode(actor, c.id, { percentage: 20 });
    await setDiscountCodeActive(actor, c.id, false);
    expect(await User.collection.findOne({ _id: owner._id })).toEqual(usersBefore);
  });
});
