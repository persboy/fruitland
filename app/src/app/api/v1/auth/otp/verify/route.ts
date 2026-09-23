import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { verifyLoginOtpAndIssueTokens } from "@/lib/server/services/authService";
import { setAuthCookies } from "@/lib/server/auth/cookies";
import { deviceFromRequest } from "@/lib/server/auth/device";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { verifyOtpSchema } from "@/lib/server/validation/authSchemas";

/**
 * Auth: none. Body: { phone, code }. Side effects: on first contact for a
 * phone, creates the User (customer role, or MASTER_ADMIN if this is
 * literally the first user in the system's history — see authService.ts);
 * issues an access+refresh token pair and sets them as httpOnly cookies.
 * Success: { user, tokens, isNewUser }. Errors: OTP_NOT_REQUESTED,
 * OTP_EXPIRED, OTP_INVALID, OTP_LOCKED, USER_DEACTIVATED.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { phone, code } = await parseJsonBody(request, verifyOtpSchema);
    const { user, tokens, isNewUser } = await verifyLoginOtpAndIssueTokens(
      phone,
      code,
      deviceFromRequest(request),
    );

    const response = apiSuccess({ user: user.toJSON(), tokens, isNewUser });
    setAuthCookies(response, tokens);
    return response;
  } catch (err) {
    return apiErrorFromException(err);
  }
}
