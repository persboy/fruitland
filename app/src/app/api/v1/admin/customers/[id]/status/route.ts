import type { NextRequest } from "next/server";
import { customerStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setCustomerActive } from "@/lib/server/services/customerService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/customers/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle).
 * No hard delete exists. Does not revoke tokens. 404 CUSTOMER_NOT_FOUND. Audited only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, customerStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setCustomerActive(userId, id, isActive), { message: isActive ? "حساب مشتری فعال شد" : "حساب مشتری غیرفعال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
