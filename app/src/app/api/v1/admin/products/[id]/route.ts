import type { NextRequest } from "next/server";
import { updateProductSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getProduct, updateProduct } from "@/lib/server/services/productService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/admin/products/[id] — Auth: admin/master_admin. Safe DTO. 404 PRODUCT_NOT_FOUND for a missing or malformed id. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getProduct(id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * PATCH /api/v1/admin/products/[id] — Auth: admin/master_admin. Body: partial { name, categoryId (a CHANGE requires an active category), description ("" clears),
 * images, isOrganic, sortOrder, variants }, at least one. `variants` is the COMPLETE list: entries with `id` keep that variant's `_id`, entries without are new;
 * omitting an existing variant is rejected (variants are never deleted — set isAvailable false). slug/isActive/id/timestamps (and unknown keys) are REJECTED
 * with 400. 404 PRODUCT_NOT_FOUND; 409 PRODUCT_CONCURRENT_UPDATE. Audited on a real change only.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateProductSchema);
    await connectToDatabase();
    return apiSuccess(await updateProduct(userId, id, input), { message: "محصول ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
