import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { updateOwnName } from "@/lib/server/services/profileService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { updateProfileSchema } from "@/lib/server/validation/adminSchemas";

/** PATCH /api/v1/admin/profile — Auth: admin/master_admin (own account only). Body: { firstName, lastName }. */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, updateProfileSchema);
    await connectToDatabase();
    const user = await updateOwnName(userId, input);
    return apiSuccess(user.toJSON(), { message: "پروفایل ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
