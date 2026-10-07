import type { NextRequest } from "next/server";
import { updateDiscountCodeSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getDiscountCode, updateDiscountCode } from "@/lib/server/services/discountCodeService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/admin/discount-codes/[id] — Auth: admin/master_admin. Safe DTO. 404 DISCOUNT_CODE_NOT_FOUND for a missing or malformed id. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getDiscountCode(id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * PATCH /api/v1/admin/discount-codes/[id] — Auth: admin/master_admin. Body: partial { percentage, maxDiscountAmount|null, minOrderAmount,
 * usageLimit|null, expiresAt "YYYY-MM-DD"|null }, at least one. code/type/ownerUserId/usedCount/isActive/status (and any unknown key) are
 * REJECTED with 400. 409 DISCOUNT_CODE_USAGE_LIMIT_BELOW_USED when the new limit is below usedCount (enforced atomically). Audited on a real change only.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateDiscountCodeSchema);
    await connectToDatabase();
    return apiSuccess(await updateDiscountCode(userId, id, input), { message: "کد تخفیف ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
