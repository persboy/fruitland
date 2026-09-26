import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { connectToDatabase } from "@/lib/server/db";
import { deleteAddress, getAddress, updateAddress } from "@/lib/server/services/addressService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { updateAddressSchema } from "@/lib/server/validation/addressSchemas";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/addresses/[id] — Auth: required. Ownership: only the address's own user (404, not 403, if it belongs to someone else — never confirms another user's address exists). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAuth(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getAddress(userId, id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** PATCH /api/v1/addresses/[id] — Auth: required. Body: partial UpdateAddressInput. Same ownership rule as GET. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAuth(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateAddressSchema);
    await connectToDatabase();
    return apiSuccess(await updateAddress(userId, id, input), { message: "آدرس ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** DELETE /api/v1/addresses/[id] — Auth: required. Same ownership rule as GET. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAuth(request);
    const { id } = await params;
    await connectToDatabase();
    await deleteAddress(userId, id);
    return apiSuccess(null, { message: "آدرس حذف شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
