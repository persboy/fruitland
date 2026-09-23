import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { loginAdminWithPassword } from "@/lib/server/services/authService";
import { setAuthCookies } from "@/lib/server/auth/cookies";
import { deviceFromRequest } from "@/lib/server/auth/device";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { adminPasswordLoginSchema } from "@/lib/server/validation/authSchemas";

/**
 * Auth: none. Body: { phone, password }. Only works for admin/master_admin
 * accounts — customer/courier are always rejected with the same generic
 * error as "wrong password" (no role/existence enumeration). Locks after
 * repeated failures (see authService.ts). Success: { user, tokens }.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { phone, password } = await parseJsonBody(request, adminPasswordLoginSchema);
    const { user, tokens } = await loginAdminWithPassword(phone, password, deviceFromRequest(request));

    const response = apiSuccess({ user: user.toJSON(), tokens });
    setAuthCookies(response, tokens);
    return response;
  } catch (err) {
    return apiErrorFromException(err);
  }
}
