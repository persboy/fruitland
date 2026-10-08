import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import * as listRoute from "./route";
import * as itemRoute from "./[id]/route";
import * as statusRoute from "./[id]/status/route";

const s = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductActive: vi.fn(),
}));
vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: s.requireAdmin }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/productService", () => ({
  listProducts: s.listProducts,
  getProduct: s.getProduct,
  createProduct: s.createProduct,
  updateProduct: s.updateProduct,
  setProductActive: s.setProductActive,
}));

const BASE = "http://localhost/api/v1/admin/products";
const OID = "64b7f0c2a1b2c3d4e5f60718";
const CAT = "64b7f0c2a1b2c3d4e5f60999";
const VID = "64b7f0c2a1b2c3d4e5f60aaa";
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const getList = (qs = "") => listRoute.GET(new NextRequest(`${BASE}${qs}`));
const post = (body: unknown, raw = false) =>
  listRoute.POST(new NextRequest(BASE, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));
const patch = (h: (r: NextRequest, c: never) => Promise<Response>, body: unknown, id = OID, raw = false) =>
  h(new NextRequest(`${BASE}/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }), idCtx(id) as never);
const deny401 = () => s.requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
const deny403 = () => s.requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });
const validCreate = { name: "سیب قرمز", categoryId: CAT, variants: [{ unit: "kg", price: 50000 }] };

beforeEach(() => {
  s.requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
  s.listProducts.mockResolvedValue({ items: [{ id: OID }], pagination: { page: 1, pageSize: 20, total: 1 } });
  s.getProduct.mockResolvedValue({ id: OID });
  s.createProduct.mockResolvedValue({ id: OID });
  s.updateProduct.mockResolvedValue({ id: OID });
  s.setProductActive.mockResolvedValue({ id: OID });
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
  ["GET /products", () => getList(), () => s.listProducts],
  ["POST /products", () => post(validCreate), () => s.createProduct],
  ["GET /products/[id]", () => itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID)), () => s.getProduct],
  ["PATCH /products/[id]", () => patch(itemRoute.PATCH, { sortOrder: 2 }), () => s.updateProduct],
  ["PATCH /products/[id]/status", () => patch(statusRoute.PATCH, { isActive: false }), () => s.setProductActive],
];

describe("authorization", () => {
  it.each(handlers)("%s: unauthenticated → 401 and nothing is called", async (_n, call, svc) => {
    deny401();
    expect((await call()).status).toBe(401);
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: authenticated non-admin (customer/courier) → 403 and nothing is called", async (_n, call, svc) => {
    deny403();
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
    expect(svc()).not.toHaveBeenCalled();
  });
  it.each(handlers)("%s: admin is allowed", async (_n, call, svc) => {
    expect([200, 201]).toContain((await call()).status);
    expect(svc()).toHaveBeenCalled();
  });
  it.each(handlers)("%s: master_admin is allowed", async (_n, call) => {
    s.requireAdmin.mockReturnValue({ userId: "m1", role: "master_admin" });
    expect([200, 201]).toContain((await call()).status);
  });
});

describe("GET /products", () => {
  it("returns the DTO list with the standard envelope and pagination", async () => {
    expect(await (await getList()).json()).toEqual({ success: true, data: [{ id: OID }], message: null, pagination: { page: 1, pageSize: 20, total: 1 }, error: null });
  });
  it("defaults to page 1, limit 20 and no filters", async () => {
    await getList();
    expect(s.listProducts).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });
  it("passes validated filters (search normalised, booleans parsed)", async () => {
    await getList(`?page=2&limit=100&search=${encodeURIComponent("سيب ۱۰")}&categoryId=${CAT}&isActive=false&isOrganic=true`);
    expect(s.listProducts).toHaveBeenCalledWith({ page: 2, limit: 100, search: "سیب 10", categoryId: CAT, isActive: false, isOrganic: true });
  });
  it.each(["?limit=101", "?limit=0", "?page=0", "?page=abc", "?categoryId=x", "?isActive=yes", "?isOrganic=1", `?search=${"a".repeat(101)}`])("%s → 400 VALIDATION_ERROR, service not called", async (qs) => {
    const res = await getList(qs);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.listProducts).not.toHaveBeenCalled();
  });
  it("a regex-looking search is passed through as plain text (the service escapes it)", async () => {
    await getList(`?search=${encodeURIComponent(".*(a+)+")}`);
    expect(s.listProducts).toHaveBeenCalledWith({ page: 1, limit: 20, search: ".*(a+)+" });
  });
  it("unknown query keys are ignored", async () => {
    await getList("?role=admin&stockQty=1");
    expect(s.listProducts).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });
  it("a service failure is a generic 500 without internals", async () => {
    s.listProducts.mockRejectedValue(new Error("mongo exploded at 10.0.0.5"));
    const res = await getList();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/mongo|10\.0\.0\.5/);
  });
});

describe("POST /products", () => {
  it("creates with 201, the envelope and the admin as actor; the name is normalised by the shared schema", async () => {
    const res = await post({ ...validCreate, name: "  سيب   قرمز " });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, data: { id: OID }, error: null });
    expect(s.createProduct).toHaveBeenCalledWith("admin1", { name: "سیب قرمز", categoryId: CAT, variants: [{ unit: "kg", price: 50000 }] });
  });
  it("accepts every contract field", async () => {
    await post({ ...validCreate, description: "تازه", images: ["https://a.example/x.png"], isOrganic: true, isActive: false, sortOrder: 3, variants: [{ unit: "kg", price: 5, isAvailable: false }, { unit: "box", price: 9 }] });
    expect(s.createProduct).toHaveBeenCalledWith("admin1", expect.objectContaining({ isOrganic: true, isActive: false, sortOrder: 3, images: ["https://a.example/x.png"] }));
  });
  it("never forwards a client slug or any legacy field", async () => {
    await post({ ...validCreate, slug: "evil", stockQty: 5, originalPrice: 9, emoji: "🍎", reviewAttributes: ["a"], id: "x" });
    const input = s.createProduct.mock.calls[0]![1] as Record<string, unknown>;
    for (const k of ["slug", "stockQty", "originalPrice", "emoji", "reviewAttributes", "id"]) expect(input).not.toHaveProperty(k);
  });
  it.each([
    ["missing name", { categoryId: CAT, variants: validCreate.variants }],
    ["blank name", { ...validCreate, name: "   " }],
    ["symbol-only name", { ...validCreate, name: "!!!" }],
    ["missing categoryId", { name: "سیب", variants: validCreate.variants }],
    ["malformed categoryId", { ...validCreate, categoryId: "x" }],
    ["NoSQL operator as categoryId", { ...validCreate, categoryId: { $ne: null } }],
    ["no variants", { ...validCreate, variants: [] }],
    ["variants missing", { name: "سیب", categoryId: CAT }],
    ["duplicate units (kg + kg)", { ...validCreate, variants: [{ unit: "kg", price: 1 }, { unit: "kg", price: 2 }] }],
    ["zero price", { ...validCreate, variants: [{ unit: "kg", price: 0 }] }],
    ["negative price", { ...validCreate, variants: [{ unit: "kg", price: -1 }] }],
    ["fractional price", { ...validCreate, variants: [{ unit: "kg", price: 1.5 }] }],
    ["string price", { ...validCreate, variants: [{ unit: "kg", price: "100" }] }],
    ["unknown unit", { ...validCreate, variants: [{ unit: "liter", price: 100 }] }],
    ["javascript: image", { ...validCreate, images: ["javascript:alert(1)"] }],
    ["negative sortOrder", { ...validCreate, sortOrder: -1 }],
  ])("invalid payload (%s) → 400 VALIDATION_ERROR, nothing is created", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(s.createProduct).not.toHaveBeenCalled();
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    const res = await post("{nope", true);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON_BODY");
  });
  it("inactive/nonexistent category → 400 PRODUCT_CATEGORY_INVALID in the envelope", async () => {
    s.createProduct.mockRejectedValue(AppError.badRequest("cat", "PRODUCT_CATEGORY_INVALID"));
    const res = await post(validCreate);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, data: null, error: { code: "PRODUCT_CATEGORY_INVALID" } });
  });
  it("slug conflict → 409 PRODUCT_SLUG_CONFLICT", async () => {
    s.createProduct.mockRejectedValue(AppError.conflict("slug", "PRODUCT_SLUG_CONFLICT"));
    const res = await post(validCreate);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("PRODUCT_SLUG_CONFLICT");
  });
});

describe("GET /products/[id]", () => {
  it("returns the DTO", async () => {
    expect(await (await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID))).json()).toMatchObject({ success: true, data: { id: OID } });
    expect(s.getProduct).toHaveBeenCalledWith(OID);
  });
  it("404 PRODUCT_NOT_FOUND passes through", async () => {
    s.getProduct.mockRejectedValue(AppError.notFound("x", "PRODUCT_NOT_FOUND"));
    const res = await itemRoute.GET(new NextRequest(`${BASE}/${OID}`), idCtx(OID));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("PATCH /products/[id]", () => {
  it("updates allowlisted fields with the admin as actor", async () => {
    const res = await patch(itemRoute.PATCH, { name: "گلابی", categoryId: CAT, description: "", sortOrder: 2, isOrganic: true });
    expect(res.status).toBe(200);
    expect(s.updateProduct).toHaveBeenCalledWith("admin1", OID, { name: "گلابی", categoryId: CAT, description: "", sortOrder: 2, isOrganic: true });
  });
  it("forwards the complete variants list with ids for existing entries and none for new ones", async () => {
    await patch(itemRoute.PATCH, { variants: [{ id: VID, price: 60000 }, { unit: "box", price: 400000 }] });
    expect(s.updateProduct).toHaveBeenCalledWith("admin1", OID, { variants: [{ id: VID, price: 60000 }, { unit: "box", price: 400000 }] });
  });
  it.each(["slug", "isActive", "id", "_id", "createdAt", "updatedAt", "category"])("attempting to change %s is rejected with 400 and nothing is written", async (key) => {
    const res = await patch(itemRoute.PATCH, { sortOrder: 1, [key]: "x" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("قابل ویرایش نیست");
    expect(s.updateProduct).not.toHaveBeenCalled();
  });
  it("a slug alone is rejected too (not turned into an empty update)", async () => {
    expect((await patch(itemRoute.PATCH, { slug: "new-slug" })).status).toBe(400);
    expect(s.updateProduct).not.toHaveBeenCalled();
  });
  it.each(["stockQty", "originalPrice", "emoji", "origin", "isBestSeller", "reviewAttributes", "image"])("legacy field %s → 400", async (key) => {
    expect((await patch(itemRoute.PATCH, { sortOrder: 1, [key]: 1 })).status).toBe(400);
    expect(s.updateProduct).not.toHaveBeenCalled();
  });
  it.each([
    ["empty body", {}],
    ["blank name", { name: "" }],
    ["malformed categoryId", { categoryId: "x" }],
    ["empty variants", { variants: [] }],
    ["duplicate units", { variants: [{ unit: "kg", price: 1 }, { unit: "kg", price: 2 }] }],
    ["new variant without price", { variants: [{ unit: "kg" }] }],
    ["malformed variant id", { variants: [{ id: "x", price: 1 }] }],
    ["zero price", { variants: [{ id: VID, price: 0 }] }],
    ["fractional price", { variants: [{ id: VID, price: 1.5 }] }],
  ])("invalid payload (%s) → 400", async (_n, body) => {
    expect((await patch(itemRoute.PATCH, body)).status).toBe(400);
    expect(s.updateProduct).not.toHaveBeenCalled();
  });
  it("service conflicts and rejections keep their status and code", async () => {
    for (const [err, status, code] of [
      [AppError.badRequest("c", "PRODUCT_CATEGORY_INVALID"), 400, "PRODUCT_CATEGORY_INVALID"],
      [AppError.badRequest("v", "PRODUCT_VARIANT_REMOVAL_NOT_ALLOWED"), 400, "PRODUCT_VARIANT_REMOVAL_NOT_ALLOWED"],
      [AppError.badRequest("v", "PRODUCT_VARIANTS_INVALID"), 400, "PRODUCT_VARIANTS_INVALID"],
      [AppError.conflict("u", "PRODUCT_CONCURRENT_UPDATE"), 409, "PRODUCT_CONCURRENT_UPDATE"],
      [AppError.notFound("n", "PRODUCT_NOT_FOUND"), 404, "PRODUCT_NOT_FOUND"],
    ] as const) {
      s.updateProduct.mockRejectedValueOnce(err);
      const res = await patch(itemRoute.PATCH, { sortOrder: 1 });
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe(code);
    }
  });
  it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
    expect((await (await patch(itemRoute.PATCH, "{nope", OID, true)).json()).error.code).toBe("INVALID_JSON_BODY");
  });
});

describe("PATCH /products/[id]/status", () => {
  it("sets the requested state with the admin as actor and a state-specific message", async () => {
    const off = await patch(statusRoute.PATCH, { isActive: false });
    expect((await off.json()).message).toBe("محصول غیرفعال شد");
    expect(s.setProductActive).toHaveBeenCalledWith("admin1", OID, false);
    const on = await patch(statusRoute.PATCH, { isActive: true });
    expect((await on.json()).message).toBe("محصول فعال شد");
    expect(s.setProductActive).toHaveBeenLastCalledWith("admin1", OID, true);
  });
  it.each([{}, { isActive: "true" }, { isActive: 1 }, { isActive: null }])("invalid body %j → 400", async (body) => {
    expect((await patch(statusRoute.PATCH, body)).status).toBe(400);
    expect(s.setProductActive).not.toHaveBeenCalled();
  });
  it("passes ONLY isActive to the service (other keys are ignored)", async () => {
    await patch(statusRoute.PATCH, { isActive: false, name: "x", variants: [] });
    expect(s.setProductActive).toHaveBeenCalledWith("admin1", OID, false);
  });
  it("404 passes through", async () => {
    s.setProductActive.mockRejectedValue(AppError.notFound("x", "PRODUCT_NOT_FOUND"));
    expect((await patch(statusRoute.PATCH, { isActive: true })).status).toBe(404);
  });
});
