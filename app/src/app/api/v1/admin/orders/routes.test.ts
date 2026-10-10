import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import * as listRoute from "./route";
import * as itemRoute from "./[id]/route";
import * as cancelRoute from "./[id]/cancel/route";

const s = vi.hoisted(() => ({ requireAdmin: vi.fn(), listOrders: vi.fn(), getOrder: vi.fn(), cancelOrder: vi.fn() }));
vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: s.requireAdmin }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/orderService", () => ({ listOrders: s.listOrders, getOrder: s.getOrder, cancelOrder: s.cancelOrder }));

const OID = "64b7f0c2a1b2c3d4e5f60718";
const BASE = "http://localhost/api/v1/admin/orders";
const getList = (qs = "") => listRoute.GET(new NextRequest(`${BASE}${qs}`));
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const getOne = () => itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
const cancel = (body: unknown, raw = false) =>
  cancelRoute.POST(new NextRequest(`${BASE}/${OID}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }), idCtx(OID));
const deny401 = () => s.requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
const deny403 = () => s.requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });

beforeEach(() => {
  s.requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
  s.listOrders.mockResolvedValue({ items: [{ id: OID }], pagination: { page: 1, pageSize: 20, total: 1 } });
  s.getOrder.mockResolvedValue({ id: OID });
  s.cancelOrder.mockResolvedValue({ id: OID });
});
afterEach(() => vi.clearAllMocks());

describe("only the approved methods exist (no create / edit / delete / status endpoints)", () => {
  it.each([["list", listRoute, ["GET"]], ["item", itemRoute, ["GET"]], ["cancel", cancelRoute, ["POST"]]] as const)("%s", (_n, mod, allowed) => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(Object.keys(mod).includes(method)).toBe(allowed.includes(method as never));
  });
});

const handlers: [string, () => Promise<Response>, () => ReturnType<typeof vi.fn>][] = [
  ["GET /orders", () => getList(), () => s.listOrders],
  ["GET /orders/[id]", () => getOne(), () => s.getOrder],
  ["POST /orders/[id]/cancel", () => cancel({ reason: "x" }), () => s.cancelOrder],
];

describe("authorization", () => {
  it.each(handlers)("%s: unauthenticated → 401, nothing called", async (_n, call, svc) => {
    deny401();
    expect((await call()).status).toBe(401);
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: forbidden role → 403, nothing called", async (_n, call, svc) => {
    deny403();
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(svc()).not.toHaveBeenCalled();
  });
  it("unexpected error → generic 500 without internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.listOrders.mockRejectedValue(new Error("mongo secret topology"));
    const res = await getList();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("mongo");
  });
});

describe("GET /orders", () => {
  it("defaults and the pagination envelope", async () => {
    const body = await (await getList()).json();
    expect(s.listOrders).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
  });
  it("forwards page, limit, search (digits normalised) and the three filters", async () => {
    await getList(`?page=2&limit=10&search=${encodeURIComponent(" ۰۰۰۱۲۳ ")}&status=shipped&deliveryStatus=picked_up&source=phone`);
    expect(s.listOrders).toHaveBeenCalledWith({ page: 2, limit: 10, search: "000123", status: "shipped", deliveryStatus: "picked_up", source: "phone" });
  });
  it.each(["?page=0", "?limit=101", "?status=paid", "?deliveryStatus=lost", "?source=app", `?search=${"a".repeat(51)}`])("invalid query %s → 400, service not called", async (qs) => {
    const res = await getList(qs);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.listOrders).not.toHaveBeenCalled();
  });
});

describe("GET /orders/[id]", () => {
  it("returns the DTO", async () => {
    expect((await (await getOne()).json()).data).toEqual({ id: OID });
    expect(s.getOrder).toHaveBeenCalledWith(OID);
  });
  it("missing → 404 ORDER_NOT_FOUND", async () => {
    s.getOrder.mockRejectedValue(AppError.notFound("سفارش یافت نشد", "ORDER_NOT_FOUND"));
    const res = await getOne();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("ORDER_NOT_FOUND");
  });
});

describe("POST /orders/[id]/cancel", () => {
  it("passes actor, id and the trimmed reason", async () => {
    const res = await cancel({ reason: "  مشتری منصرف شد  " });
    expect(res.status).toBe(200);
    expect(s.cancelOrder).toHaveBeenCalledWith("admin1", OID, "مشتری منصرف شد");
  });
  it.each([[{}], [{ reason: "" }], [{ reason: "   " }], [{ reason: 7 }], [{ reason: "x".repeat(501) }]])("invalid/blank reason %j → 400, nothing cancelled", async (body) => {
    const res = await cancel(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.cancelOrder).not.toHaveBeenCalled();
  });
  it.each(["status", "isPaid", "paidAt", "canceledByUserId", "delivery"])("a client-supplied %s is rejected, never forwarded", async (key) => {
    expect((await cancel({ reason: "x", [key]: "y" })).status).toBe(400);
    expect(s.cancelOrder).not.toHaveBeenCalled();
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    const res = await cancel("{nope", true);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON_BODY");
  });
  it.each([
    [AppError.notFound("m", "ORDER_NOT_FOUND"), 404],
    [AppError.conflict("m", "ORDER_ALREADY_CANCELLED"), 409],
    [AppError.conflict("m", "ORDER_NOT_CANCELLABLE"), 409],
    [AppError.conflict("m", "ORDER_IN_DELIVERY"), 409],
  ])("service error %# keeps its code and status", async (err, status) => {
    s.cancelOrder.mockRejectedValue(err);
    const res = await cancel({ reason: "x" });
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(err.code);
  });
});
