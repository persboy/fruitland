import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAuth, requireRole } from "@/lib/server/auth/guard";
import { setInitialPassword } from "@/lib/server/services/authService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { initialPasswordSchema } from "@/lib/server/validation/authSchemas";

/**
 * Auth: required (admin / master_admin). Body: { newPassword }. Sets the very
 * first password of an account that has none (e.g. the freshly claimed
 * MASTER_ADMIN). Errors: 409 PASSWORD_ALREADY_SET, 403 FORBIDDEN_ROLE.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireRole(auth, ["admin", "master_admin"]);
    const { newPassword } = await parseJsonBody(request, initialPasswordSchema);
    await connectToDatabase();
    await setInitialPassword(auth.userId, newPassword);
    return apiSuccess(null, { message: "رمز عبور تنظیم شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
