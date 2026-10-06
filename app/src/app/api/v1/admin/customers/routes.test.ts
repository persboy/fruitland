import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import * as listRoute from "./route";
import * as itemRoute from "./[id]/route";
import * as statusRoute from "./[id]/status/route";

const s = vi.hoisted(() => ({ requireAdmin: vi.fn(), listCustomers: vi.fn(), getCustomer: vi.fn(), updateCustomerProfile: vi.fn(), setCustomerActive: vi.fn() }));
vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: s.requireAdmin }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/customerService", () => ({
  listCustomers: s.listCustomers, getCustomer: s.getCustomer, updateCustomerProfile: s.updateCustomerProfile, setCustomerActive: s.setCustomerActive,
}));

const BASE = "http://localhost/api/v1/admin/customers";
const getList = (qs = "") => listRoute.GET(new NextRequest(`${BASE}${qs}`));
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (h: (r: NextRequest, c: never) => Promise<Response>, body: unknown, id = OID, raw = false) =>
  h(new NextRequest(`${BASE}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }), idCtx(id) as never);
const OID = "64b7f0c2a1b2c3d4e5f60718";
const deny401 = () => s.requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
const deny403 = () => s.requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });

beforeEach(() => {
  s.requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
  s.listCustomers.mockResolvedValue({ items: [{ id: OID }], pagination: { page: 1, pageSize: 20, total: 1 } });
  s.getCustomer.mockResolvedValue({ id: OID });
  s.updateCustomerProfile.mockResolvedValue({ id: OID });
  s.setCustomerActive.mockResolvedValue({ id: OID });
});
afterEach(() => vi.clearAllMocks());

describe("only the approved methods exist (no create, no delete, no phone/role endpoints)", () => {
  it.each([["list", listRoute, ["GET"]], ["item", itemRoute, ["GET", "PATCH"]], ["status", statusRoute, ["PATCH"]]] as const)("%s", (_n, mod, allowed) => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(Object.keys(mod).includes(method)).toBe(allowed.includes(method as never));
  });
});

const handlers: [string, () => Promise<Response>, () => ReturnType<typeof vi.fn>][] = [
  ["GET /customers", () => getList(), () => s.listCustomers],
  ["GET /customers/[id]", () => itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID)), () => s.getCustomer],
  ["PATCH /customers/[id]", () => send(itemRoute.PATCH, { firstName: "علی" }), () => s.updateCustomerProfile],
  ["PATCH /customers/[id]/status", () => send(statusRoute.PATCH, { isActive: false }), () => s.setCustomerActive],
];
describe("authorization", () => {
  it.each(handlers)("%s: unauthenticated → 401 and nothing is called", async (_n, call, svc) => {
    deny401();
    const res = await call();
    expect(res.status).toBe(401);
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: forbidden role (customer/courier) → 403 and nothing is called", async (_n, call, svc) => {
    deny403();
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: admin is allowed", async (_n, call, svc) => {
    expect((await call()).status).toBe(200);
    expect(svc()).toHaveBeenCalled();
  });
  it.each(handlers)("%s: master_admin is allowed", async (_n, call) => {
    s.requireAdmin.mockReturnValue({ userId: "m1", role: "master_admin" });
    expect((await call()).status).toBe(200);
  });
});

describe("GET /customers", () => {
  it("returns the DTO list with the standard envelope and pagination", async () => {
    expect(await (await getList()).json()).toEqual({ success: true, data: [{ id: OID }], message: null, pagination: { page: 1, pageSize: 20, total: 1 }, error: null });
  });
  it("passes defaults (page 1, limit 20, status all)", async () => {
    await getList();
    expect(s.listCustomers).toHaveBeenCalledWith({ page: 1, limit: 20, status: "all" });
  });
  it("passes validated page/limit/search/status; Persian digits in search are normalised", async () => {
    await getList(`?page=2&limit=50&search=${encodeURIComponent("۰۹۱۲")}&status=inactive`);
    expect(s.listCustomers).toHaveBeenCalledWith({ page: 2, limit: 50, search: "0912", status: "inactive" });
  });
  it("the client cannot override the role restriction: role/isActive query params are ignored", async () => {
    await getList("?role=admin&isActive=true");
    expect(s.listCustomers).toHaveBeenCalledWith({ page: 1, limit: 20, status: "all" });
  });
  it.each(["?page=0", "?page=abc", "?limit=0", "?limit=101", "?limit=-5", "?status=deleted", `?search=${"a".repeat(51)}`])("invalid query %s → 400 VALIDATION_ERROR, service not called", async (qs) => {
    const res = await getList(qs);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.listCustomers).not.toHaveBeenCalled();
  });
  it("unexpected error → generic 500 without internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.listCustomers.mockRejectedValue(new Error("mongo secret topology"));
    const res = await getList();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("mongo");
  });
});

describe("GET /customers/[id]", () => {
  it("returns the detail DTO", async () => {
    const res = await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
    expect((await res.json()).data).toEqual({ id: OID });
    expect(s.getCustomer).toHaveBeenCalledWith(OID);
  });
  it.each(["missing", "non-customer"])("%s id → 404 CUSTOMER_NOT_FOUND (identical response)", async () => {
    s.getCustomer.mockRejectedValue(AppError.notFound("مشتری یافت نشد", "CUSTOMER_NOT_FOUND"));
    const res = await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "CUSTOMER_NOT_FOUND", message: "مشتری یافت نشد" });
  });
});

describe("PATCH /customers/[id] (profile)", () => {
  it("passes the actor, the id and ONLY firstName/lastName/birthDate", async () => {
    const res = await send(itemRoute.PATCH, {
      firstName: " علی ", lastName: "رضایی", birthDate: "1990-05-17",
      phone: "09120000000", role: "admin", isActive: false, customerCode: "12345", referralCode: "X", referredByUserId: OID,
      addresses: [], courierProfile: {}, passwordHash: "x", passwordFailedAttempts: 0, passwordLockedUntil: "2030-01-01",
    });
    expect(res.status).toBe(200);
    expect(s.updateCustomerProfile).toHaveBeenCalledWith("admin1", OID, { firstName: "علی", lastName: "رضایی", birthDate: "1990-05-17" });
  });
  it("a body with only protected fields has nothing editable → 400", async () => {
    const res = await send(itemRoute.PATCH, { phone: "0999", role: "admin", isActive: false });
    expect(res.status).toBe(400);
    expect(s.updateCustomerProfile).not.toHaveBeenCalled();
  });
  it.each([[{}], [{ birthDate: "2023-02-29" }], [{ birthDate: "2999-01-01" }], [{ birthDate: "1990/01/01" }], [{ firstName: "a".repeat(51) }], [{ firstName: 7 }]])("invalid body %j → 400 VALIDATION_ERROR", async (body) => {
    const res = await send(itemRoute.PATCH, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.updateCustomerProfile).not.toHaveBeenCalled();
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    const res = await send(itemRoute.PATCH, "{nope", OID, true);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON_BODY");
  });
  it("not found / non-customer → 404 CUSTOMER_NOT_FOUND", async () => {
    s.updateCustomerProfile.mockRejectedValue(AppError.notFound("مشتری یافت نشد", "CUSTOMER_NOT_FOUND"));
    const res = await send(itemRoute.PATCH, { firstName: "x" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});

describe("PATCH /customers/[id]/status", () => {
  it.each([true, false])("sets isActive=%s explicitly for the id, with the actor", async (isActive) => {
    const res = await send(statusRoute.PATCH, { isActive, role: "admin" });
    expect(res.status).toBe(200);
    expect(s.setCustomerActive).toHaveBeenCalledWith("admin1", OID, isActive);
  });
  it.each([[{}], [{ isActive: "false" }], [{ isActive: 0 }], [{ isActive: null }]])("invalid body %j → 400", async (body) => {
    expect((await send(statusRoute.PATCH, body)).status).toBe(400);
    expect(s.setCustomerActive).not.toHaveBeenCalled();
  });
  it("not found / non-customer → 404 CUSTOMER_NOT_FOUND", async () => {
    s.setCustomerActive.mockRejectedValue(AppError.notFound("مشتری یافت نشد", "CUSTOMER_NOT_FOUND"));
    const res = await send(statusRoute.PATCH, { isActive: false });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});
