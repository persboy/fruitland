import type { NextRequest } from "next/server";
import { discountCodeStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setDiscountCodeActive } from "@/lib/server/services/discountCodeService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/discount-codes/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle).
 * Changes only isActive; there is no hard delete. 404 DISCOUNT_CODE_NOT_FOUND. Audited only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, discountCodeStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setDiscountCodeActive(userId, id, isActive), { message: isActive ? "کد تخفیف فعال شد" : "کد تخفیف غیرفعال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
