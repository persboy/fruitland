import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { logout } from "@/lib/server/services/authService";
import { clearAuthCookies, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth/cookies";
import { parseOptionalJsonBody } from "@/lib/server/validation/parseJsonBody";

/**
 * Auth: none required beyond presenting the refresh token — logging out
 * with an already-invalid token is not an error (idempotent). Ends only
 * this one session/device; other devices keep working. Use
 * DELETE /api/v1/auth/sessions to end every other session too.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const cookieToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const body = await parseOptionalJsonBody(request);
    const bodyToken = typeof body.refreshToken === "string" ? body.refreshToken : undefined;
    const rawRefreshToken = cookieToken ?? bodyToken;

    if (rawRefreshToken) {
      await logout(rawRefreshToken);
    }

    const response = apiSuccess(null, { message: "خارج شدید" });
    clearAuthCookies(response);
    return response;
  } catch (err) {
    return apiErrorFromException(err);
  }
}
