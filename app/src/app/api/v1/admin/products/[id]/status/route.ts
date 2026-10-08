import type { NextRequest } from "next/server";
import { productStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setProductActive } from "@/lib/server/services/productService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/products/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle).
 * Changes only isActive; there is no hard delete and variants are untouched. 404 PRODUCT_NOT_FOUND. Audited only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, productStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setProductActive(userId, id, isActive), { message: isActive ? "محصول فعال شد" : "محصول غیرفعال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
