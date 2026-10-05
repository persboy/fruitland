import type { NextRequest } from "next/server";
import { updateCategorySchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { updateCategory } from "@/lib/server/services/categoryService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/categories/[id] — Auth: admin/master_admin. Body: partial { name, slug, icon, sortOrder }
 * (icon "" clears it). `isActive` is NOT editable here (see …/status). 404 CATEGORY_NOT_FOUND (also for a malformed id),
 * 409 CATEGORY_SLUG_TAKEN. Audited. There is intentionally no DELETE: deactivate instead.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateCategorySchema);
    await connectToDatabase();
    return apiSuccess(await updateCategory(userId, id, input), { message: "دسته‌بندی ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
