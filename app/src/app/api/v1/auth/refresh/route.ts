import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { rotateRefreshToken } from "@/lib/server/services/authService";
import { setAuthCookies, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth/cookies";
import { deviceFromRequest } from "@/lib/server/auth/device";
import { parseOptionalJsonBody } from "@/lib/server/validation/parseJsonBody";
import { AppError } from "@/lib/server/errors/AppError";

/**
 * Auth: a valid, non-revoked refresh token — from the httpOnly cookie
 * (web) or { refreshToken } in the body (mobile/app client), cookie takes
 * precedence when both are present. Single-use: rotates to a new pair.
 * Reused/replayed old tokens revoke every session for that user as a
 * theft precaution (see authService.rotateRefreshToken). Success: { tokens }.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const cookieToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const body = await parseOptionalJsonBody(request);
    const bodyToken = typeof body.refreshToken === "string" ? body.refreshToken : undefined;
    const rawRefreshToken = cookieToken ?? bodyToken;

    if (!rawRefreshToken) {
      throw AppError.unauthorized("Refresh Token ارسال نشده است", "MISSING_REFRESH_TOKEN");
    }

    const { user, tokens } = await rotateRefreshToken(rawRefreshToken, deviceFromRequest(request));
    const response = apiSuccess({ user: user.toJSON(), tokens });
    setAuthCookies(response, tokens);
    return response;
  } catch (err) {
    return apiErrorFromException(err);
  }
}
