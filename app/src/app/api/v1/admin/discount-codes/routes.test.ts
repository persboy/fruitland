import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import * as listRoute from "./route";
import * as itemRoute from "./[id]/route";
import * as statusRoute from "./[id]/status/route";

const s = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listDiscountCodes: vi.fn(),
  getDiscountCode: vi.fn(),
  createDiscountCode: vi.fn(),
  updateDiscountCode: vi.fn(),
  setDiscountCodeActive: vi.fn(),
}));
vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: s.requireAdmin }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/discountCodeService", () => ({
  listDiscountCodes: s.listDiscountCodes,
  getDiscountCode: s.getDiscountCode,
  createDiscountCode: s.createDiscountCode,
  updateDiscountCode: s.updateDiscountCode,
  setDiscountCodeActive: s.setDiscountCodeActive,
}));

const BASE = "http://localhost/api/v1/admin/discount-codes";
const OID = "64b7f0c2a1b2c3d4e5f60718";
const OWNER = "64b7f0c2a1b2c3d4e5f60999";
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const getList = (qs = "") => listRoute.GET(new NextRequest(`${BASE}${qs}`));
const post = (body: unknown, raw = false) =>
  listRoute.POST(new NextRequest(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));
const patch = (h: (r: NextRequest, c: never) => Promise<Response>, body: unknown, id = OID, raw = false) =>
  h(new NextRequest(`${BASE}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }), idCtx(id) as never);
const deny401 = () => s.requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
const deny403 = () => s.requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });
const validCreate = { code: "welcome10", type: "public", percentage: 10 };

beforeEach(() => {
  s.requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
  s.listDiscountCodes.mockResolvedValue({ items: [{ id: OID }], pagination: { page: 1, pageSize: 20, total: 1 } });
  s.getDiscountCode.mockResolvedValue({ id: OID });
  s.createDiscountCode.mockResolvedValue({ id: OID });
  s.updateDiscountCode.mockResolvedValue({ id: OID });
  s.setDiscountCodeActive.mockResolvedValue({ id: OID });
});
afterEach(() => vi.clearAllMocks());

describe("only the approved methods exist (no DELETE, no PUT)", () => {
  it.each([
    ["list", listRoute, ["GET", "POST"]],
    ["item", itemRoute, ["GET", "PATCH"]],
    ["status", statusRoute, ["PATCH"]],
  ] as const)("%s", (_n, mod, allowed) => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(Object.keys(mod).includes(method)).toBe(allowed.includes(method as never));
  });
});

const handlers: [string, () => Promise<Response>, () => ReturnType<typeof vi.fn>][] = [
  ["GET /discount-codes", () => getList(), () => s.listDiscountCodes],
  ["POST /discount-codes", () => post(validCreate), () => s.createDiscountCode],
  ["GET /discount-codes/[id]", () => itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID)), () => s.getDiscountCode],
  ["PATCH /discount-codes/[id]", () => patch(itemRoute.PATCH, { percentage: 20 }), () => s.updateDiscountCode],
  ["PATCH /discount-codes/[id]/status", () => patch(statusRoute.PATCH, { isActive: false }), () => s.setDiscountCodeActive],
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
    const res = await call();
    expect([200, 201]).toContain(res.status);
    expect(svc()).toHaveBeenCalled();
  });
  it.each(handlers)("%s: master_admin is allowed", async (_n, call) => {
    s.requireAdmin.mockReturnValue({ userId: "m1", role: "master_admin" });
    expect([200, 201]).toContain((await call()).status);
  });
});

describe("GET /discount-codes", () => {
  it("returns the DTO list with the standard envelope and pagination", async () => {
    expect(await (await getList()).json()).toEqual({ success: true, data: [{ id: OID }], message: null, pagination: { page: 1, pageSize: 20, total: 1 }, error: null });
  });
  it("passes defaults (page 1, limit 20, type all, status all)", async () => {
    await getList();
    expect(s.listDiscountCodes).toHaveBeenCalledWith({ page: 1, limit: 20, type: "all", status: "all" });
  });
  it("passes validated filters; search is uppercased and Persian digits are normalised", async () => {
    await getList(`?page=2&limit=50&search=${encodeURIComponent("off۱۲")}&type=personal&status=expired`);
    expect(s.listDiscountCodes).toHaveBeenCalledWith({ page: 2, limit: 50, search: "OFF12", type: "personal", status: "expired" });
  });
  it.each(["?limit=101", "?limit=0", "?page=0", "?page=abc", "?type=vip", "?status=deleted", `?search=${"A".repeat(31)}`])("%s → 400 VALIDATION_ERROR, service not called", async (qs) => {
    const res = await getList(qs);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.listDiscountCodes).not.toHaveBeenCalled();
  });
  it("unknown query keys are ignored", async () => {
    await getList("?role=admin&ownerUserId=x");
    expect(s.listDiscountCodes).toHaveBeenCalledWith({ page: 1, limit: 20, type: "all", status: "all" });
  });
  it("a service failure is a generic 500 without internals", async () => {
    s.listDiscountCodes.mockRejectedValue(new Error("mongo exploded at 10.0.0.5"));
    const res = await getList();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/mongo|10\.0\.0\.5/);
  });
});

describe("POST /discount-codes", () => {
  it("creates with 201, the envelope and the admin as actor; the code is normalised by the shared schema", async () => {
    const res = await post(validCreate);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, data: { id: OID }, error: null });
    expect(s.createDiscountCode).toHaveBeenCalledWith("admin1", { code: "WELCOME10", type: "public", percentage: 10 });
  });
  it("accepts a personal code with an owner and every optional field", async () => {
    await post({ ...validCreate, type: "personal", ownerUserId: OWNER, maxDiscountAmount: 50000, minOrderAmount: 100000, usageLimit: 5, expiresAt: "2026-10-07" });
    expect(s.createDiscountCode).toHaveBeenCalledWith("admin1", expect.objectContaining({ type: "personal", ownerUserId: OWNER, usageLimit: 5, expiresAt: "2026-10-07" }));
  });
  it("never forwards usedCount, isActive or status from the client", async () => {
    await post({ ...validCreate, usedCount: 99, isActive: false, status: "expired", role: "master_admin" });
    const input = s.createDiscountCode.mock.calls[0]![1] as Record<string, unknown>;
    for (const k of ["usedCount", "isActive", "status", "role"]) expect(input).not.toHaveProperty(k);
  });
  it.each([
    ["missing code", { type: "public", percentage: 10 }],
    ["bad characters", { ...validCreate, code: "AB CD" }],
    ["too short", { ...validCreate, code: "AB" }],
    ["too long", { ...validCreate, code: "A".repeat(31) }],
    ["decimal percentage", { ...validCreate, percentage: 10.5 }],
    ["percentage 0", { ...validCreate, percentage: 0 }],
    ["percentage 101", { ...validCreate, percentage: 101 }],
    ["personal without owner", { ...validCreate, type: "personal" }],
    ["public with owner", { ...validCreate, ownerUserId: OWNER }],
    ["malformed owner id", { ...validCreate, type: "personal", ownerUserId: "x" }],
    ["fractional money", { ...validCreate, minOrderAmount: 10.5 }],
    ["usageLimit 0", { ...validCreate, usageLimit: 0 }],
    ["invalid expiry", { ...validCreate, expiresAt: "2026-02-30" }],
    ["unknown type", { ...validCreate, type: "vip" }],
  ])("invalid payload (%s) → 400 VALIDATION_ERROR, nothing is created", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.createDiscountCode).not.toHaveBeenCalled();
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    const res = await post("{nope", true);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON_BODY");
  });
  it("duplicate code → 409 DISCOUNT_CODE_DUPLICATE in the standard envelope", async () => {
    s.createDiscountCode.mockRejectedValue(AppError.conflict("dup", "DISCOUNT_CODE_DUPLICATE"));
    const res = await post(validCreate);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, data: null, error: { code: "DISCOUNT_CODE_DUPLICATE" } });
  });
  it("invalid owner → 400 DISCOUNT_CODE_OWNER_INVALID", async () => {
    s.createDiscountCode.mockRejectedValue(AppError.badRequest("owner", "DISCOUNT_CODE_OWNER_INVALID"));
    const res = await post({ ...validCreate, type: "personal", ownerUserId: OWNER });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("DISCOUNT_CODE_OWNER_INVALID");
  });
});

describe("GET /discount-codes/[id]", () => {
  it("returns the DTO", async () => {
    expect(await (await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID))).json()).toMatchObject({ success: true, data: { id: OID } });
    expect(s.getDiscountCode).toHaveBeenCalledWith(OID);
  });
  it("404 DISCOUNT_CODE_NOT_FOUND passes through", async () => {
    s.getDiscountCode.mockRejectedValue(AppError.notFound("x", "DISCOUNT_CODE_NOT_FOUND"));
    const res = await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("DISCOUNT_CODE_NOT_FOUND");
  });
});

describe("PATCH /discount-codes/[id]", () => {
  it("updates editable fields with the admin as actor", async () => {
    const res = await patch(itemRoute.PATCH, { percentage: 20, maxDiscountAmount: null, usageLimit: 9, expiresAt: "2026-10-07" });
    expect(res.status).toBe(200);
    expect(s.updateDiscountCode).toHaveBeenCalledWith("admin1", OID, { percentage: 20, maxDiscountAmount: null, usageLimit: 9, expiresAt: "2026-10-07" });
  });
  it.each(["code", "type", "ownerUserId", "usedCount", "isActive", "status"])("attempting to change %s is rejected with 400 and nothing is written", async (key) => {
    const res = await patch(itemRoute.PATCH, { percentage: 20, [key]: "x" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("قابل ویرایش نیست");
    expect(s.updateDiscountCode).not.toHaveBeenCalled();
  });
  it("an immutable field alone is also rejected (not silently turned into an empty update)", async () => {
    expect((await patch(itemRoute.PATCH, { code: "NEWCODE" })).status).toBe(400);
    expect(s.updateDiscountCode).not.toHaveBeenCalled();
  });
  it.each([
    ["empty body", {}],
    ["decimal percentage", { percentage: 10.5 }],
    ["percentage 0", { percentage: 0 }],
    ["percentage null", { percentage: null }],
    ["maxDiscountAmount 0", { maxDiscountAmount: 0 }],
    ["usageLimit 0", { usageLimit: 0 }],
    ["bad expiry", { expiresAt: "1405/07/15" }],
    ["unknown key", { percentage: 10, foo: 1 }],
  ])("invalid payload (%s) → 400", async (_n, body) => {
    const res = await patch(itemRoute.PATCH, body);
    expect(res.status).toBe(400);
    expect(s.updateDiscountCode).not.toHaveBeenCalled();
  });
  it("usageLimit below usedCount → 409 DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED", async () => {
    s.updateDiscountCode.mockRejectedValue(AppError.conflict("low", "DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED"));
    const res = await patch(itemRoute.PATCH, { usageLimit: 1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED");
  });
  it("404 passes through", async () => {
    s.updateDiscountCode.mockRejectedValue(AppError.notFound("x", "DISCOUNT_CODE_NOT_FOUND"));
    expect((await patch(itemRoute.PATCH, { percentage: 5 })).status).toBe(404);
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    expect((await (await patch(itemRoute.PATCH, "{nope", OID, true)).json()).error.code).toBe("INVALID_JSON_BODY");
  });
});

describe("PATCH /discount-codes/[id]/status", () => {
  it("sets the requested state with the admin as actor and a state-specific message", async () => {
    const off = await patch(statusRoute.PATCH, { isActive: false });
    expect((await off.json()).message).toBe("کد تخفیف غیرفعال شد");
    expect(s.setDiscountCodeActive).toHaveBeenCalledWith("admin1", OID, false);
    const on = await patch(statusRoute.PATCH, { isActive: true });
    expect((await on.json()).message).toBe("کد تخفیف فعال شد");
    expect(s.setDiscountCodeActive).toHaveBeenLastCalledWith("admin1", OID, true);
  });
  it.each([{}, { isActive: "true" }, { isActive: 1 }, { isActive: null }])("invalid body %j → 400", async (body) => {
    expect((await patch(statusRoute.PATCH, body)).status).toBe(400);
    expect(s.setDiscountCodeActive).not.toHaveBeenCalled();
  });
  it("passes ONLY isActive to the service (other keys are ignored)", async () => {
    await patch(statusRoute.PATCH, { isActive: false, usedCount: 0, percentage: 1 });
    expect(s.setDiscountCodeActive).toHaveBeenCalledWith("admin1", OID, false);
  });
  it("404 passes through", async () => {
    s.setDiscountCodeActive.mockRejectedValue(AppError.notFound("x", "DISCOUNT_CODE_NOT_FOUND"));
    expect((await patch(statusRoute.PATCH, { isActive: true })).status).toBe(404);
  });
});
