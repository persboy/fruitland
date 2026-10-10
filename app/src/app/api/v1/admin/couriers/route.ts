import type { NextRequest } from "next/server";
import { courierListQuerySchema, createCourierSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { createCourier, listCouriers } from "@/lib/server/services/courierService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/admin/couriers?page&limit&search&status — Auth: admin/master_admin. Only role=courier users (not overridable
 * by the client). page ≥ 1; limit 1–100 (default 20); search ≤ 50 chars over phone/firstName/lastName; status
 * active|inactive|all (default all). Newest first. Response: CourierDto list + envelope `pagination {page,pageSize,total}`.
 */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const query = parseQuery(request, courierListQuerySchema);
    await connectToDatabase();
    const { items, pagination } = await listCouriers(query);
    return apiSuccess(items, { pagination });
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * POST /api/v1/admin/couriers — Auth: admin/master_admin. Promotes an EXISTING customer (never creates a user).
 * Body: { userId, vehicleType: car|motorcycle|bicycle, plateNumber? }. Any other key (role, status, location…) → 400.
 * 404 COURIER_CANDIDATE_NOT_FOUND; 409 USER_ALREADY_COURIER; 400 COURIER_CANDIDATE_NOT_CUSTOMER |
 * COURIER_CANDIDATE_INACTIVE | COURIER_CANDIDATE_PROFILE_INCOMPLETE. Audited as `courier.created`.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, createCourierSchema);
    await connectToDatabase();
    return apiSuccess(await createCourier(userId, input), { message: "مشتری به پیک تبدیل شد", status: 201 });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
