import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { GET, POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/categoryService", () => ({ listCategories: vi.fn(), createCategory: vi.fn() }));

const DTO = { id: "64b7f0c2a1b2c3d4e5f60718", name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1, isActive: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const get = () => GET(new NextRequest("http://localhost/api/v1/admin/categories"));
const post = (body: unknown, raw = false) =>
  POST(new NextRequest("http://localhost/api/v1/admin/categories", { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));

describe("/api/v1/admin/categories", () => {
  let requireAdmin: ReturnType<typeof vi.fn>;
  let listCategories: ReturnType<typeof vi.fn>;
  let createCategory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAdmin } = (await import("@/lib/server/auth/guard")) as unknown as { requireAdmin: typeof requireAdmin });
    ({ listCategories, createCategory } = (await import("@/lib/server/services/categoryService")) as unknown as { listCategories: typeof listCategories; createCategory: typeof createCategory });
    requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
    listCategories.mockResolvedValue([DTO]);
    createCategory.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  describe("GET", () => {
    it("unauthenticated → 401 before any data access", async () => {
      requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      const res = await get();
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
      expect(listCategories).not.toHaveBeenCalled();
    });

    it("forbidden role → 403 before any data access", async () => {
      requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });
      const res = await get();
      expect(res.status).toBe(403);
      expect(listCategories).not.toHaveBeenCalled();
    });

    it("authorized admin gets the list in the standard envelope", async () => {
      const res = await get();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, data: [DTO], message: null, pagination: null, error: null });
    });

    it("an unexpected error is a generic 500 that leaks nothing", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      listCategories.mockRejectedValue(new Error("mongo secret topology details"));
      const res = await get();
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain("mongo");
    });
  });

  describe("POST", () => {
    it("unauthenticated → 401 and nothing is created", async () => {
      requireAdmin.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      expect((await post({ name: "n", slug: "s" })).status).toBe(401);
      expect(createCategory).not.toHaveBeenCalled();
    });

    it("forbidden role → 403 and nothing is created", async () => {
      requireAdmin.mockImplementation(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });
      expect((await post({ name: "n", slug: "s" })).status).toBe(403);
      expect(createCategory).not.toHaveBeenCalled();
    });

    it("creates with 201, passing the authenticated actor and ONLY validated fields (isActive and unknown keys are dropped)", async () => {
      const res = await post({ name: " میوه ", slug: "Fruit", icon: "🍎", sortOrder: 1, isActive: false, role: "master_admin", _id: "x" });
      expect(res.status).toBe(201);
      expect((await res.json()).data).toEqual(DTO);
      expect(createCategory).toHaveBeenCalledWith("admin1", { name: "میوه", slug: "fruit", icon: "🍎", sortOrder: 1 });
    });

    it.each([
      [{ slug: "a" }],
      [{ name: "n" }],
      [{ name: "n", slug: "Bad Slug!" }],
      [{ name: "n", slug: "a", sortOrder: -1 }],
      [{ name: "n", slug: "a", sortOrder: 1.5 }],
      [{ name: "n", slug: "a", sortOrder: "3" }],
    ])("validation failure %j → 400 VALIDATION_ERROR, nothing created", async (body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
      expect(createCategory).not.toHaveBeenCalled();
    });

    it("malformed JSON → 400 INVALID_JSON_BODY", async () => {
      const res = await post("{not json", true);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_JSON_BODY");
    });

    it("duplicate slug → 409 CATEGORY_SLUG_TAKEN with the standard error envelope", async () => {
      createCategory.mockRejectedValue(AppError.conflict("تکراری", "CATEGORY_SLUG_TAKEN"));
      const res = await post({ name: "n", slug: "s" });
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body).toEqual({ success: false, data: null, message: null, pagination: null, error: { code: "CATEGORY_SLUG_TAKEN", message: "تکراری" } });
    });
  });

  it("exposes no DELETE handler (hard delete does not exist)", async () => {
    const mod = (await import("./route")) as Record<string, unknown>;
    expect(mod.DELETE).toBeUndefined();
    const item = (await import("./[id]/route")) as Record<string, unknown>;
    expect(item.DELETE).toBeUndefined();
    expect(item.PUT).toBeUndefined();
  });
});
