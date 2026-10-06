import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { startTestDb, stopTestDb, clearTestDb } from "../models/testDb";
import { AuditLog } from "../models/AuditLog";
import { User } from "../models/User";
import { getCustomer, listCustomers, setCustomerActive, updateCustomerProfile } from "./customerService";

/**
 * Real-MongoDB tests for the Customers admin service (standalone mongod is
 * enough — no multi-document transaction). Run with `npm run test:integration`.
 */
describe("customers (integration, real MongoDB)", () => {
  const actor = new Types.ObjectId().toString();
  let n = 0;
  const make = (over: Record<string, unknown> = {}) => User.create({ phone: `0912000${String(++n).padStart(4, "0")}`, role: "customer", ...over });
  const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, status: "all" as const, ...over });

  beforeAll(async () => {
    await startTestDb();
    await User.init(); // build indexes (incl. {role, createdAt}) before any write
  }, 120_000);
  afterAll(stopTestDb);
  afterEach(clearTestDb);

  it("lists ONLY role=customer users, whatever the status filter", async () => {
    await make();
    await make({ isActive: false });
    await make({ role: "courier" });
    await make({ role: "admin" });
    await make({ role: "master_admin" });
    for (const status of ["all", "active", "inactive"] as const) {
      const { items } = await listCustomers(q({ status }));
      expect(items.length).toBe(status === "all" ? 2 : 1);
    }
    expect((await listCustomers(q())).pagination.total).toBe(2);
  });

  it("orders newest first and paginates for real (no overlap, correct totals, out-of-range page is empty)", async () => {
    for (let i = 0; i < 5; i++) {
      await make({ firstName: `c${i}` });
      await new Promise((r) => setTimeout(r, 5));
    }
    const p1 = await listCustomers(q({ limit: 2, page: 1 }));
    const p2 = await listCustomers(q({ limit: 2, page: 2 }));
    const p3 = await listCustomers(q({ limit: 2, page: 3 }));
    expect([...p1.items, ...p2.items, ...p3.items].map((c) => c.firstName)).toEqual(["c4", "c3", "c2", "c1", "c0"]);
    expect(p1.pagination).toEqual({ page: 1, pageSize: 2, total: 5 });
    expect(p3.items).toHaveLength(1);
    expect((await listCustomers(q({ limit: 2, page: 9 }))).items).toEqual([]);
  });

  it("search matches phone / first name / last name (and full names), never other fields, and treats regex characters literally", async () => {
    await make({ phone: "09121111111", firstName: "علی", lastName: "رضایی", customerCode: "12345", referralCode: "REFX" });
    await make({ phone: "09122222222", firstName: "مریم", lastName: "کریمی" });
    expect((await listCustomers(q({ search: "علی" }))).items).toHaveLength(1);
    expect((await listCustomers(q({ search: "کریمی" }))).items).toHaveLength(1);
    expect((await listCustomers(q({ search: "2222" }))).items.map((c) => c.phone)).toEqual(["09122222222"]);
    expect((await listCustomers(q({ search: "علی رضایی" }))).items).toHaveLength(1);
    expect((await listCustomers(q({ search: "علی کریمی" }))).items).toHaveLength(0);
    expect((await listCustomers(q({ search: "12345" }))).items).toHaveLength(0); // customerCode is not searchable
    expect((await listCustomers(q({ search: "REFX" }))).items).toHaveLength(0); // referralCode is not searchable
    expect((await listCustomers(q({ search: ".*" }))).items).toHaveLength(0); // literal, not "match everything"
    expect((await listCustomers(q({ search: "(" }))).items).toHaveLength(0); // would be an invalid regex if unescaped
    // search never widens the role restriction
    await make({ role: "admin", phone: "09123333333", firstName: "علی" });
    expect((await listCustomers(q({ search: "علی" }))).items).toHaveLength(1);
  });

  it("profile update persists (names, birthDate as a date-only value) and is audited; a no-op is not", async () => {
    const u = await make({ firstName: "علی", lastName: "رضایی" });
    const id = u._id.toString();
    const dto = await updateCustomerProfile(actor, id, { firstName: "حسن", birthDate: "1990-05-17" });
    expect(dto).toMatchObject({ firstName: "حسن", lastName: "رضایی", birthDate: "1990-05-17" });
    const stored = await User.findById(id);
    expect(stored!.birthDate!.toISOString()).toBe("1990-05-17T00:00:00.000Z");
    expect((await AuditLog.find({ entityId: u._id }).sort({ _id: 1 })).map((a) => a.action)).toEqual(["customer.name_updated", "customer.birth_date_updated"]);
    await updateCustomerProfile(actor, id, { firstName: "حسن", birthDate: "1990-05-17" });
    expect(await AuditLog.countDocuments({ entityId: u._id })).toBe(2);
    await updateCustomerProfile(actor, id, { lastName: "" });
    expect((await getCustomer(id)).lastName).toBeNull();
  });

  it("status changes persist, are audited once per real change, and never touch other fields", async () => {
    const u = await make({ firstName: "علی" });
    const id = u._id.toString();
    await setCustomerActive(actor, id, false);
    await setCustomerActive(actor, id, false); // no-op
    expect((await User.findById(id))!.isActive).toBe(false);
    await setCustomerActive(actor, id, true);
    expect((await AuditLog.find({ entityId: u._id }).sort({ _id: 1 })).map((a) => a.action)).toEqual(["customer.deactivated", "customer.activated"]);
    const after = await User.findById(id);
    expect(after).toMatchObject({ firstName: "علی", role: "customer", phone: u.phone });
  });

  it("non-customer users can be neither read nor modified through the Customers service", async () => {
    const courier = await make({ role: "courier", firstName: "پیک" });
    const admin = await make({ role: "admin", firstName: "ادمین" });
    for (const u of [courier, admin]) {
      const id = u._id.toString();
      await expect(getCustomer(id)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
      await expect(updateCustomerProfile(actor, id, { firstName: "x" })).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
      await expect(setCustomerActive(actor, id, false)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
      const fresh = await User.findById(id);
      expect(fresh).toMatchObject({ firstName: u.firstName, isActive: true });
    }
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it("phone uniqueness is still enforced by the database", async () => {
    const a = await make();
    await expect(User.create({ phone: a.phone, role: "customer" })).rejects.toMatchObject({ code: 11000 });
  });

  it("concurrent opposite status requests leave a consistent document and a coherent audit trail", async () => {
    const u = await make();
    const id = u._id.toString();
    await Promise.all(Array.from({ length: 8 }, (_, i) => setCustomerActive(actor, id, i % 2 === 0)));
    const final = await User.findById(id);
    expect(typeof final!.isActive).toBe("boolean");
    expect(await User.countDocuments({ _id: u._id })).toBe(1);
    const audits = await AuditLog.find({ entityId: u._id }).sort({ _id: 1 });
    // every audit entry records a real transition; consecutive entries must alternate
    for (let i = 1; i < audits.length; i++) expect(audits[i]!.action).not.toBe(audits[i - 1]!.action);
  });

  it("the {role, createdAt} index exists", async () => {
    const indexes = await User.collection.indexes();
    expect(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ role: 1, createdAt: -1 }))).toBe(true);
  });
});
