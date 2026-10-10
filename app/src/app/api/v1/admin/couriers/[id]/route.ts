import type { NextRequest } from "next/server";
import { updateCourierSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getCourier, updateCourier } from "@/lib/server/services/courierService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/admin/couriers/[id] — Auth: admin/master_admin. Safe CourierDto. 404 COURIER_NOT_FOUND for a missing, malformed or NON-COURIER id (indistinguishable). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getCourier(id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * PATCH /api/v1/admin/couriers/[id] — Auth: admin/master_admin. Body: partial { vehicleType, plateNumber ("" clears) }, at least
 * one. Any other key (role, isActive, status, location, …) → 400. 404 COURIER_NOT_FOUND. Audited as `courier.updated` only on a real change.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateCourierSchema);
    await connectToDatabase();
    return apiSuccess(await updateCourier(userId, id, input), { message: "اطلاعات پیک ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
