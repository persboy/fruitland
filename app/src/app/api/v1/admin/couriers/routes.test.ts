import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import * as listRoute from "./route";
import * as itemRoute from "./[id]/route";
import * as statusRoute from "./[id]/status/route";

const s = vi.hoisted(() => ({ requireAdmin: vi.fn(), listCouriers: vi.fn(), getCourier: vi.fn(), createCourier: vi.fn(), updateCourier: vi.fn(), setCourierActive: vi.fn() }));
vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: s.requireAdmin }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/courierService", () => ({
  listCouriers: s.listCouriers, getCourier: s.getCourier, createCourier: s.createCourier, updateCourier: s.updateCourier, setCourierActive: s.setCourierActive,
}));

const OID = "64b7f0c2a1b2c3d4e5f60718";
const BASE = "http://localhost/api/v1/admin/couriers";
const getList = (qs = "") => listRoute.GET(new NextRequest(`${BASE}${qs}`));
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, raw = false) =>
  listRoute.POST(new NextRequest(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));
const patch = (h: (r: NextRequest, c: never) => Promise<Response>, body: unknown, id = OID, raw = false) =>
  h(new NextRequest(`${BASE}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }), idCtx(id) as never);
const deny401 = () => s.requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
const deny403 = () => s.requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });

beforeEach(() => {
  s.requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
  s.listCouriers.mockResolvedValue({ items: [{ id: OID }], pagination: { page: 1, pageSize: 20, total: 1 } });
  s.getCourier.mockResolvedValue({ id: OID });
  s.createCourier.mockResolvedValue({ id: OID });
  s.updateCourier.mockResolvedValue({ id: OID });
  s.setCourierActive.mockResolvedValue({ id: OID });
});
afterEach(() => vi.clearAllMocks());

describe("only the approved methods exist (no downgrade / delete / location / availability endpoints)", () => {
  it.each([["list", listRoute, ["GET", "POST"]], ["item", itemRoute, ["GET", "PATCH"]], ["status", statusRoute, ["PATCH"]]] as const)("%s", (_n, mod, allowed) => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(Object.keys(mod).includes(method)).toBe(allowed.includes(method as never));
  });
});

const handlers: [string, () => Promise<Response>, () => ReturnType<typeof vi.fn>][] = [
  ["GET /couriers", () => getList(), () => s.listCouriers],
  ["POST /couriers", () => post({ userId: OID, vehicleType: "car" }), () => s.createCourier],
  ["GET /couriers/[id]", () => itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID)), () => s.getCourier],
  ["PATCH /couriers/[id]", () => patch(itemRoute.PATCH, { vehicleType: "bicycle" }), () => s.updateCourier],
  ["PATCH /couriers/[id]/status", () => patch(statusRoute.PATCH, { isActive: false }), () => s.setCourierActive],
];

describe("authorization", () => {
  it.each(handlers)("%s: unauthenticated → 401 and nothing is called", async (_n, call, svc) => {
    deny401();
    expect((await call()).status).toBe(401);
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: forbidden role (customer/courier) → 403 and nothing is called", async (_n, call, svc) => {
    deny403();
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: admin is allowed", async (_n, call) => {
    expect([200, 201]).toContain((await call()).status);
  });
  it("unexpected error → generic 500 without internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.listCouriers.mockRejectedValue(new Error("mongo secret topology"));
    const res = await getList();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("mongo");
  });
});

describe("GET /couriers (pagination, search, status filter)", () => {
  it("passes the validated query (defaults) to the service and returns the pagination envelope", async () => {
    const res = await getList();
    const body = await res.json();
    expect(s.listCouriers).toHaveBeenCalledWith({ page: 1, limit: 20, status: "all" });
    expect(body.data).toEqual([{ id: OID }]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
  });
  it("forwards page, limit, search (digits normalised) and status", async () => {
    await getList(`?page=3&limit=10&search=${encodeURIComponent(" ۰۹۱۲ ")}&status=inactive`);
    expect(s.listCouriers).toHaveBeenCalledWith({ page: 3, limit: 10, search: "0912", status: "inactive" });
  });
  it("the client cannot override the role restriction: role/isActive/status-availability query params are ignored", async () => {
    await getList("?role=admin&isActive=true&availabilityStatus=online");
    expect(s.listCouriers).toHaveBeenCalledWith({ page: 1, limit: 20, status: "all" });
  });
  it.each(["?page=0", "?page=abc", "?limit=0", "?limit=101", "?status=busy", `?search=${"a".repeat(51)}`])("invalid query %s → 400 VALIDATION_ERROR, service not called", async (qs) => {
    const res = await getList(qs);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.listCouriers).not.toHaveBeenCalled();
  });
});

describe("POST /couriers (promote an existing customer)", () => {
  it("passes the actor and ONLY userId/vehicleType/plateNumber; responds 201", async () => {
    const res = await post({ userId: OID, vehicleType: "motorcycle", plateNumber: " ۱۲ب۳۴ " });
    expect(res.status).toBe(201);
    expect(s.createCourier).toHaveBeenCalledWith("admin1", { userId: OID, vehicleType: "motorcycle", plateNumber: "12ب34" });
  });
  it.each(["role", "courierProfile", "status", "currentLocation", "isActive", "availabilityStatus"])("a client-supplied %s is rejected with 400, never forwarded", async (key) => {
    const res = await post({ userId: OID, vehicleType: "car", [key]: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.createCourier).not.toHaveBeenCalled();
  });
  it.each([[{}], [{ vehicleType: "car" }], [{ userId: OID }], [{ userId: OID, vehicleType: "plane" }], [{ userId: "abc", vehicleType: "car" }], [{ userId: OID, vehicleType: "car", plateNumber: "x".repeat(21) }]])("invalid body %j → 400", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(s.createCourier).not.toHaveBeenCalled();
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    const res = await post("{nope", true);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON_BODY");
  });
  it.each([
    [AppError.notFound("m", "COURIER_CANDIDATE_NOT_FOUND"), 404],
    [AppError.conflict("m", "USER_ALREADY_COURIER"), 409],
    [AppError.badRequest("m", "COURIER_CANDIDATE_NOT_CUSTOMER"), 400],
    [AppError.badRequest("m", "COURIER_CANDIDATE_INACTIVE"), 400],
    [AppError.badRequest("m", "COURIER_CANDIDATE_PROFILE_INCOMPLETE"), 400],
  ])("service error %# keeps its safe code and status", async (err, status) => {
    s.createCourier.mockRejectedValue(err);
    const res = await post({ userId: OID, vehicleType: "car" });
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(err.code);
  });
});

describe("GET /couriers/[id]", () => {
  it("returns the DTO", async () => {
    const res = await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
    expect((await res.json()).data).toEqual({ id: OID });
    expect(s.getCourier).toHaveBeenCalledWith(OID);
  });
  it("missing or non-courier id → 404 COURIER_NOT_FOUND (identical response)", async () => {
    s.getCourier.mockRejectedValue(AppError.notFound("پیک یافت نشد", "COURIER_NOT_FOUND"));
    const res = await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "COURIER_NOT_FOUND", message: "پیک یافت نشد" });
  });
});

describe("PATCH /couriers/[id]", () => {
  it("passes the actor, id and ONLY vehicleType/plateNumber", async () => {
    const res = await patch(itemRoute.PATCH, { vehicleType: "bicycle", plateNumber: "" });
    expect(res.status).toBe(200);
    expect(s.updateCourier).toHaveBeenCalledWith("admin1", OID, { vehicleType: "bicycle", plateNumber: "" });
  });
  it.each(["role", "isActive", "phone", "courierProfile", "currentLocation", "status"])("a client-supplied %s is rejected with 400 (no role change / arbitrary User update)", async (key) => {
    const res = await patch(itemRoute.PATCH, { vehicleType: "car", [key]: "x" });
    expect(res.status).toBe(400);
    expect(s.updateCourier).not.toHaveBeenCalled();
  });
  it.each([[{}], [{ vehicleType: "boat" }], [{ plateNumber: 5 }]])("invalid body %j → 400 VALIDATION_ERROR", async (body) => {
    const res = await patch(itemRoute.PATCH, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
  it("not found → 404 COURIER_NOT_FOUND", async () => {
    s.updateCourier.mockRejectedValue(AppError.notFound("پیک یافت نشد", "COURIER_NOT_FOUND"));
    const res = await patch(itemRoute.PATCH, { vehicleType: "car" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("COURIER_NOT_FOUND");
  });
});

describe("PATCH /couriers/[id]/status", () => {
  it.each([true, false])("sets isActive=%s explicitly for the id, with the actor", async (isActive) => {
    const res = await patch(statusRoute.PATCH, { isActive });
    expect(res.status).toBe(200);
    expect(s.setCourierActive).toHaveBeenCalledWith("admin1", OID, isActive);
  });
  it.each([[{}], [{ isActive: "false" }], [{ isActive: 0 }], [{ isActive: null }]])("invalid body %j → 400", async (body) => {
    expect((await patch(statusRoute.PATCH, body)).status).toBe(400);
    expect(s.setCourierActive).not.toHaveBeenCalled();
  });
  it.each(["status", "availabilityStatus", "currentLocation", "role"])("client-supplied %s is rejected (availability / location are never accepted)", async (key) => {
    expect((await patch(statusRoute.PATCH, { isActive: true, [key]: "online" })).status).toBe(400);
    expect(s.setCourierActive).not.toHaveBeenCalled();
  });
  it("deactivation with an active run → HTTP 409 COURIER_HAS_ACTIVE_RUN in the standard error envelope", async () => {
    s.setCourierActive.mockRejectedValue(AppError.conflict("این پیک یک ماموریت فعال دارد", "COURIER_HAS_ACTIVE_RUN"));
    const res = await patch(statusRoute.PATCH, { isActive: false });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("COURIER_HAS_ACTIVE_RUN");
  });
  it("not found → 404 COURIER_NOT_FOUND", async () => {
    s.setCourierActive.mockRejectedValue(AppError.notFound("پیک یافت نشد", "COURIER_NOT_FOUND"));
    expect((await patch(statusRoute.PATCH, { isActive: false })).status).toBe(404);
  });
});
