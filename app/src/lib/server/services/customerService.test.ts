import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), auditCreate: vi.fn() }));
vi.mock("../models/User", () => ({ User: { find: m.find, countDocuments: m.countDocuments, findOne: m.findOne, findOneAndUpdate: m.findOneAndUpdate } }));
vi.mock("../models/AuditLog", () => ({ AuditLog: { create: m.auditCreate } }));

import { getCustomer, listCustomers, setCustomerActive, updateCustomerProfile } from "./customerService";

const actor = new Types.ObjectId().toString();
const lean = <T,>(v: T) => ({ lean: () => Promise.resolve(v) });
const T0 = new Date("2026-01-01T10:00:00Z");
const user = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(), phone: "09120000001", firstName: "علی", lastName: "رضایی", isActive: true, createdAt: T0, updatedAt: T0, ...over,
});
const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, status: "all" as const, ...over });
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
});

describe("listCustomers", () => {
  it("always filters role=customer, sorts newest first, paginates, and returns metadata", async () => {
    const chain = listChain([user()]);
    m.find.mockReturnValue(chain);
    m.countDocuments.mockResolvedValue(45);
    const out = await listCustomers(q({ page: 3, limit: 10 }));
    expect(m.find.mock.calls[0]![0]).toEqual({ role: "customer" });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(m.countDocuments).toHaveBeenCalledWith({ role: "customer" });
    expect(out.pagination).toEqual({ page: 3, pageSize: 10, total: 45 });
  });

  it("uses an explicit projection with ONLY the list fields (no auth/courier/referral/code fields)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCustomers(q());
    expect(Object.keys(m.find.mock.calls[0]![1] as object).sort()).toEqual(["createdAt", "firstName", "isActive", "lastName", "phone"]);
  });

  it.each([["active", true], ["inactive", false]])("status=%s filters isActive=%s while keeping role=customer", async (status, isActive) => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCustomers(q({ status }));
    expect(m.find.mock.calls[0]![0]).toEqual({ role: "customer", isActive });
  });

  it("status=all adds no isActive condition (inactive customers do not disappear)", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCustomers(q({ status: "all" }));
    expect(m.find.mock.calls[0]![0]).not.toHaveProperty("isActive");
  });

  it("search: each token must match phone OR firstName OR lastName; role stays outside the search", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCustomers(q({ search: "علی رضایی" }));
    const filter = m.find.mock.calls[0]![0] as { role: string; $and: { $or: { [k: string]: RegExp }[] }[] };
    expect(filter.role).toBe("customer");
    expect(filter.$and).toHaveLength(2);
    for (const cond of filter.$and) expect(cond.$or.map((c) => Object.keys(c)[0])).toEqual(["phone", "firstName", "lastName"]);
    expect(filter.$and[0]!.$or[1]!.firstName!.test("علی")).toBe(true);
    expect(m.countDocuments).toHaveBeenCalledWith(m.find.mock.calls[0]![0]);
  });

  it("search input is escaped (regex metacharacters are literals) and tokens are capped at 3", async () => {
    m.find.mockReturnValue(listChain([]));
    m.countDocuments.mockResolvedValue(0);
    await listCustomers(q({ search: ".* (a+)+ [x] \\ $" }));
    const filter = m.find.mock.calls[0]![0] as { $and: { $or: { phone: RegExp }[] }[] };
    expect(filter.$and.length).toBeLessThanOrEqual(3);
    const dot = filter.$and[0]!.$or[0]!.phone;
    expect(dot.test("09123456789")).toBe(false); // ".*" is literal, not "match anything"
    expect(dot.test("x.*y")).toBe(true);
    await listCustomers(q({ search: "a b c d e f" }));
    expect((m.find.mock.calls[1]![0] as { $and: unknown[] }).$and).toHaveLength(3);
  });

  it("builds explicit DTOs: unset names are null, dates are ISO, nothing else leaks", async () => {
    const secret = user({ firstName: undefined, passwordHash: "H", courierProfile: { x: 1 }, referralCode: "R", customerCode: "12345", role: "customer" });
    m.find.mockReturnValue(listChain([secret]));
    m.countDocuments.mockResolvedValue(1);
    const { items } = await listCustomers(q());
    expect(items[0]).toEqual({ id: secret._id.toString(), firstName: null, lastName: "رضایی", phone: "09120000001", isActive: true, createdAt: T0.toISOString() });
    expect(JSON.stringify(items)).not.toMatch(/passwordHash|courierProfile|referralCode|customerCode|role/);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("getCustomer", () => {
  it("filters by id AND role=customer, projects explicitly, and returns a safe detail DTO without coordinates", async () => {
    const aId = new Types.ObjectId();
    const u = user({
      birthDate: new Date("1990-05-17T00:00:00Z"), lastLoginAt: T0,
      addresses: [{ _id: aId, label: "home", recipientName: "علی", phone: "0912", province: "تهران", city: "تهران", addressLine: "خیابان ۱", postalCode: "123", isDefault: true,
        location: { latitude: 35, longitude: 51 }, deliveryNotes: "زنگ بزنید", resolvedBy: { provider: "neshan" } }],
      passwordHash: "H", courierProfile: { currentLocation: { lat: 1 } },
    });
    m.findOne.mockReturnValue(lean(u));
    const dto = await getCustomer(u._id.toString());
    expect(m.findOne.mock.calls[0]![0]).toEqual({ _id: u._id, role: "customer" });
    const projection = m.findOne.mock.calls[0]![1] as Record<string, number>;
    expect(Object.keys(projection).join()).not.toMatch(/password|courier|referral|customerCode|location|deliveryNotes|resolvedBy|role/);
    expect(dto.birthDate).toBe("1990-05-17");
    expect(dto.lastLoginAt).toBe(T0.toISOString());
    expect(dto.addresses).toEqual([{ id: aId.toString(), label: "home", recipientName: "علی", phone: "0912", province: "تهران", city: "تهران", addressLine: "خیابان ۱", postalCode: "123", isDefault: true }]);
    expect(JSON.stringify(dto)).not.toMatch(/latitude|longitude|deliveryNotes|resolvedBy|passwordHash|courierProfile/);
  });

  it("null birthDate/lastLogin and no addresses", async () => {
    m.findOne.mockReturnValue(lean(user()));
    expect(await getCustomer(new Types.ObjectId().toString())).toMatchObject({ birthDate: null, lastLoginAt: null, addresses: [] });
  });

  it("missing id, malformed id and NON-CUSTOMER id are all the same 404 (the role filter makes a staff id look missing)", async () => {
    m.findOne.mockReturnValue(lean(null));
    await expect(getCustomer(new Types.ObjectId().toString())).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    await expect(getCustomer("nope")).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    expect(m.findOne).toHaveBeenCalledTimes(1); // malformed id never queried
  });
});

describe("updateCustomerProfile", () => {
  const id = new Types.ObjectId();
  const after = () => lean(user({ _id: id }));

  it("updates a name atomically with role=customer in the filter and audits customer.name_updated before/after", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, firstName: "علی", lastName: "رضایی" })).mockReturnValueOnce(after());
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, firstName: "علی", lastName: "رضایی" }));
    await updateCustomerProfile(actor, id.toString(), { firstName: "حسن" });
    expect(m.findOneAndUpdate.mock.calls[0]![0]).toEqual({ _id: id, role: "customer" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $set: { firstName: "حسن" } });
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "customer.name_updated", entityType: "User", entityId: id,
      before: { firstName: "علی", lastName: "رضایی" }, after: { firstName: "حسن", lastName: "رضایی" },
    });
  });

  it('"" clears a name with $unset', async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, firstName: "علی", lastName: "رضایی" })).mockReturnValueOnce(after());
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, firstName: "علی", lastName: "رضایی" }));
    await updateCustomerProfile(actor, id.toString(), { lastName: "" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $unset: { lastName: 1 } });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ after: { firstName: "علی", lastName: "" } });
  });

  it("birthDate: stored as a UTC-midnight Date and audited as customer.birth_date_updated (YYYY-MM-DD before/after)", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, birthDate: new Date("1990-05-17T00:00:00Z") })).mockReturnValueOnce(after());
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, birthDate: new Date("1990-05-17T00:00:00Z") }));
    await updateCustomerProfile(actor, id.toString(), { birthDate: "1991-06-18" });
    expect(m.findOneAndUpdate.mock.calls[0]![1]).toEqual({ $set: { birthDate: new Date("1991-06-18T00:00:00.000Z") } });
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate).toHaveBeenCalledWith({
      actorUserId: actor, action: "customer.birth_date_updated", entityType: "User", entityId: id,
      before: { birthDate: "1990-05-17" }, after: { birthDate: "1991-06-18" },
    });
  });

  it("a first birthDate (none before) audits before:null", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id })).mockReturnValueOnce(after());
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id }));
    await updateCustomerProfile(actor, id.toString(), { birthDate: "1991-06-18" });
    expect(m.auditCreate.mock.calls[0]![0]).toMatchObject({ before: { birthDate: null }, after: { birthDate: "1991-06-18" } });
  });

  it("name + birthDate in one request → one write, two audit entries", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, firstName: "علی" })).mockReturnValueOnce(after());
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, firstName: "علی" }));
    await updateCustomerProfile(actor, id.toString(), { firstName: "حسن", birthDate: "1991-06-18" });
    expect(m.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(m.auditCreate.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual(["customer.name_updated", "customer.birth_date_updated"]);
  });

  it("only the three profile fields can ever be written", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id })).mockReturnValueOnce(after());
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id }));
    await updateCustomerProfile(actor, id.toString(), { firstName: "حسن", phone: "0999", role: "admin", isActive: false, passwordHash: "x" } as never);
    const update = JSON.stringify(m.findOneAndUpdate.mock.calls[0]![1]);
    expect(update).toBe(JSON.stringify({ $set: { firstName: "حسن" } }));
  });

  it("no-op (same values) → no write and no audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, firstName: "علی", lastName: "رضایی", birthDate: new Date("1990-05-17T00:00:00Z") })).mockReturnValueOnce(after());
    await updateCustomerProfile(actor, id.toString(), { firstName: "علی", birthDate: "1990-05-17" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("non-customer / missing / malformed id → 404 and nothing written or audited", async () => {
    m.findOne.mockReturnValue(lean(null));
    await expect(updateCustomerProfile(actor, id.toString(), { firstName: "x" })).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    await expect(updateCustomerProfile(actor, "bad", { firstName: "x" })).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("the customer vanishing (or losing the customer role) between read and write → 404, no audit", async () => {
    m.findOne.mockReturnValue(lean({ _id: id, firstName: "علی" }));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    await expect(updateCustomerProfile(actor, id.toString(), { firstName: "x" })).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("setCustomerActive", () => {
  const id = new Types.ObjectId();
  it.each([[false, true, "customer.deactivated"], [true, false, "customer.activated"]])("isActive=%s (from %s) is a conditional role=customer write audited as %s", async (to, from, action) => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: from })).mockReturnValueOnce(lean(user({ _id: id, isActive: to })));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, isActive: from }));
    const dto = await setCustomerActive(actor, id.toString(), to);
    expect(m.findOneAndUpdate).toHaveBeenCalledWith({ _id: id, role: "customer", isActive: from }, { $set: { isActive: to } }, expect.objectContaining({ new: false }));
    expect(dto.isActive).toBe(to);
    expect(m.auditCreate).toHaveBeenCalledWith({ actorUserId: actor, action, entityType: "User", entityId: id, before: { isActive: from }, after: { isActive: to } });
  });
  it("the state it already has → no write, no audit", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true })).mockReturnValueOnce(lean(user({ _id: id })));
    await setCustomerActive(actor, id.toString(), true);
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it("lost race (conditional write matched nothing) → no audit, latest state returned", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true })).mockReturnValueOnce(lean(user({ _id: id, isActive: false })));
    m.findOneAndUpdate.mockReturnValue(lean(null));
    expect((await setCustomerActive(actor, id.toString(), false)).isActive).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it("non-customer / missing / malformed id → 404 CUSTOMER_NOT_FOUND", async () => {
    m.findOne.mockReturnValue(lean(null));
    await expect(setCustomerActive(actor, id.toString(), false)).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    await expect(setCustomerActive(actor, "zzz", false)).rejects.toMatchObject({ status: 404, code: "CUSTOMER_NOT_FOUND" });
    expect(m.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it("never touches tokens or other collections (only User + AuditLog are mocked/used)", async () => {
    m.findOne.mockReturnValueOnce(lean({ _id: id, isActive: true })).mockReturnValueOnce(lean(user({ _id: id, isActive: false })));
    m.findOneAndUpdate.mockReturnValue(lean({ _id: id, isActive: true }));
    await setCustomerActive(actor, id.toString(), false);
    expect(JSON.stringify(m.findOneAndUpdate.mock.calls[0]![1])).toBe('{"$set":{"isActive":false}}');
  });
});
