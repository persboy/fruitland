import type { NextRequest } from "next/server";
import { updateCustomerProfileSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getCustomer, updateCustomerProfile } from "@/lib/server/services/customerService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/admin/customers/[id] — Auth: admin/master_admin. Safe detail DTO. 404 CUSTOMER_NOT_FOUND for a missing, malformed or NON-CUSTOMER id (indistinguishable). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getCustomer(id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * PATCH /api/v1/admin/customers/[id] — Auth: admin/master_admin. Body: partial { firstName, lastName, birthDate "YYYY-MM-DD" },
 * at least one. All other keys (phone, role, isActive, …) are stripped. 404 CUSTOMER_NOT_FOUND. Audited (name / birthDate) only on a real change.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateCustomerProfileSchema);
    await connectToDatabase();
    return apiSuccess(await updateCustomerProfile(userId, id, input), { message: "اطلاعات مشتری ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
