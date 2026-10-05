import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { PATCH } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/categoryService", () => ({ updateCategory: vi.fn() }));

const ID = "64b7f0c2a1b2c3d4e5f60718";
const DTO = { id: ID, name: "میوه", slug: "fruit", icon: null, sortOrder: 3, isActive: true, createdAt: "x", updatedAt: "y" };
const patch = (body: unknown, id = ID) =>
  PATCH(new NextRequest(`http://localhost/api/v1/admin/categories/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe("PATCH /api/v1/admin/categories/[id]", () => {
  let requireAdmin: ReturnType<typeof vi.fn>;
  let updateCategory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAdmin } = (await import("@/lib/server/auth/guard")) as unknown as { requireAdmin: typeof requireAdmin });
    ({ updateCategory } = (await import("@/lib/server/services/categoryService")) as unknown as { updateCategory: typeof updateCategory });
    requireAdmin.mockReturnValue({ userId: "admin1", role: "master_admin" });
    updateCategory.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("unauthenticated → 401, forbidden → 403; the service is never reached", async () => {
    requireAdmin.mockImplementationOnce(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await patch({ name: "n" })).status).toBe(401);
    requireAdmin.mockImplementationOnce(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });
    expect((await patch({ name: "n" })).status).toBe(403);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("updates with the actor, the path id and validated fields only; isActive and unknown keys never pass", async () => {
    const res = await patch({ sortOrder: 3, icon: "", isActive: false, _id: "z", createdAt: "z" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(DTO);
    expect(updateCategory).toHaveBeenCalledWith("admin1", ID, { sortOrder: 3, icon: "" });
  });

  it.each([[{}], [{ isActive: false }], [{ slug: "Bad Slug" }], [{ sortOrder: -5 }], [{ name: "" }]])("invalid body %j → 400, nothing updated", async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("not found / invalid id → 404 CATEGORY_NOT_FOUND from the service", async () => {
    updateCategory.mockRejectedValue(AppError.notFound("یافت نشد", "CATEGORY_NOT_FOUND"));
    const res = await patch({ name: "n" }, "garbage");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("CATEGORY_NOT_FOUND");
    expect(updateCategory).toHaveBeenCalledWith("admin1", "garbage", { name: "n" });
  });

  it("duplicate slug → 409 CATEGORY_SLUG_TAKEN", async () => {
    updateCategory.mockRejectedValue(AppError.conflict("تکراری", "CATEGORY_SLUG_TAKEN"));
    const res = await patch({ slug: "taken" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CATEGORY_SLUG_TAKEN");
  });
});
