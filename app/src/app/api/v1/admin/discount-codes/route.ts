import type { NextRequest } from "next/server";
import { createDiscountCodeSchema, discountCodeListQuerySchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { createDiscountCode, listDiscountCodes } from "@/lib/server/services/discountCodeService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/admin/discount-codes?page&limit&search&type&status — Auth: admin/master_admin. page ≥ 1; limit 1–100 (default 20);
 * search ≤ 30 chars over the CODE only; type all|public|personal; status all|active|disabled|exhausted|expired (filtered in MongoDB).
 * Newest first. Response: DTO list + envelope `pagination {page,pageSize,total}`.
 */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const query = parseQuery(request, discountCodeListQuerySchema);
    await connectToDatabase();
    const { items, pagination } = await listDiscountCodes(query);
    return apiSuccess(items, { pagination });
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * POST /api/v1/admin/discount-codes — Auth: admin/master_admin. Body: { code, type, ownerUserId? (personal only, an ACTIVE customer),
 * percentage (integer 1–100), maxDiscountAmount?, minOrderAmount?, usageLimit?, expiresAt? ("YYYY-MM-DD" = end of that day in Tehran) }.
 * usedCount/isActive/status are never accepted. 400 DISCOUNT_CODE_OWNER_INVALID; 409 DISCOUNT_CODE_DUPLICATE. Audited.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, createDiscountCodeSchema);
    await connectToDatabase();
    return apiSuccess(await createDiscountCode(userId, input), { message: "کد تخفیف ایجاد شد", status: 201 });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
