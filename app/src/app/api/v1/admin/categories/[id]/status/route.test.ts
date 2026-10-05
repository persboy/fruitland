import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { PATCH } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/categoryService", () => ({ setCategoryActive: vi.fn() }));

const ID = "64b7f0c2a1b2c3d4e5f60718";
const DTO = { id: ID, name: "میوه", slug: "fruit", icon: null, sortOrder: 0, isActive: false, createdAt: "x", updatedAt: "y" };
const patch = (body: unknown, id = ID) =>
  PATCH(new NextRequest(`http://localhost/api/v1/admin/categories/${id}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

describe("PATCH /api/v1/admin/categories/[id]/status", () => {
  let requireAdmin: ReturnType<typeof vi.fn>;
  let setCategoryActive: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAdmin } = (await import("@/lib/server/auth/guard")) as unknown as { requireAdmin: typeof requireAdmin });
    ({ setCategoryActive } = (await import("@/lib/server/services/categoryService")) as unknown as { setCategoryActive: typeof setCategoryActive });
    requireAdmin.mockReturnValue({ userId: "admin1", role: "admin" });
    setCategoryActive.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("unauthenticated → 401, forbidden → 403; the service is never reached", async () => {
    requireAdmin.mockImplementationOnce(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await patch({ isActive: false })).status).toBe(401);
    requireAdmin.mockImplementationOnce(() => { throw AppError.forbidden("x", "FORBIDDEN_ROLE"); });
    expect((await patch({ isActive: false })).status).toBe(403);
    expect(setCategoryActive).not.toHaveBeenCalled();
  });

  it("deactivates and activates with distinct messages, passing actor, id and the boolean", async () => {
    const off = await patch({ isActive: false });
    expect(off.status).toBe(200);
    expect((await off.json()).message).toBe("دسته‌بندی غیرفعال شد");
    expect(setCategoryActive).toHaveBeenLastCalledWith("admin1", ID, false);
    const on = await patch({ isActive: true });
    expect((await on.json()).message).toBe("دسته‌بندی فعال شد");
    expect(setCategoryActive).toHaveBeenLastCalledWith("admin1", ID, true);
  });

  it.each([[{}], [{ isActive: "false" }], [{ isActive: 1 }], [{ name: "x" }]])("invalid body %j → 400 VALIDATION_ERROR", async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(setCategoryActive).not.toHaveBeenCalled();
  });

  it("not found → 404 CATEGORY_NOT_FOUND (never a silent success)", async () => {
    setCategoryActive.mockRejectedValue(AppError.notFound("یافت نشد", "CATEGORY_NOT_FOUND"));
    const res = await patch({ isActive: true }, "nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("CATEGORY_NOT_FOUND");
  });
});
