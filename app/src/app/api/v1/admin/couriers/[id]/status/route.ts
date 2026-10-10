import type { NextRequest } from "next/server";
import { courierStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setCourierActive } from "@/lib/server/services/courierService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/couriers/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle);
 * availability status and location are never accepted. Deactivating a courier who has an active DeliveryRun → 409
 * COURIER_HAS_ACTIVE_RUN (checked and written in one transaction). 404 COURIER_NOT_FOUND. Does not revoke tokens.
 * Audited (`courier.activated` / `courier.deactivated`) only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, courierStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setCourierActive(userId, id, isActive), { message: isActive ? "حساب پیک فعال شد" : "حساب پیک غیرفعال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
