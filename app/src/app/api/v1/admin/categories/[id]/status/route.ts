import type { NextRequest } from "next/server";
import { categoryStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setCategoryActive } from "@/lib/server/services/categoryService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/categories/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle).
 * The only way to activate/deactivate (no hard delete exists). 404 CATEGORY_NOT_FOUND. Audited only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, categoryStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setCategoryActive(userId, id, isActive), {
      message: isActive ? "دسته‌بندی فعال شد" : "دسته‌بندی غیرفعال شد",
    });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
