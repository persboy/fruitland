import type { NextRequest } from "next/server";
import { createCategorySchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { createCategory, listCategories } from "@/lib/server/services/categoryService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

/** GET /api/v1/admin/categories — Auth: admin/master_admin. Returns every category (active and inactive) ordered by sortOrder, name, _id. Not paginated (a small admin-managed taxonomy). */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    await connectToDatabase();
    return apiSuccess(await listCategories());
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** POST /api/v1/admin/categories — Auth: admin/master_admin. Body: { name, slug, icon?, sortOrder? }. Always created active. 409 CATEGORY_SLUG_TAKEN on a duplicate slug. Audited. */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, createCategorySchema);
    await connectToDatabase();
    return apiSuccess(await createCategory(userId, input), { message: "دسته‌بندی ایجاد شد", status: 201 });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
