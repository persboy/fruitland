import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { changeOwnPassword } from "@/lib/server/services/profileService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { changePasswordSchema } from "@/lib/server/validation/adminSchemas";

/**
 * POST /api/v1/admin/profile/password — Auth: admin/master_admin. Body:
 * { currentPassword?, newPassword }. currentPassword is required only when a
 * password already exists. Errors: 400 CURRENT_PASSWORD_REQUIRED,
 * 403 CURRENT_PASSWORD_INVALID / PASSWORD_LOCKED.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, changePasswordSchema);
    await connectToDatabase();
    await changeOwnPassword(userId, input);
    return apiSuccess(null, { message: "رمز عبور تغییر کرد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
