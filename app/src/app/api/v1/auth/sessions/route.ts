import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAuth } from "@/lib/server/auth/guard";
import { verifyRefreshToken } from "@/lib/server/auth/jwt";
import { REFRESH_TOKEN_COOKIE } from "@/lib/server/auth/cookies";
import { listActiveSessions, revokeAllSessions } from "@/lib/server/services/authService";

function currentJtiFrom(request: NextRequest): string | undefined {
  const token = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!token) return undefined;
  try {
    return verifyRefreshToken(token).jti;
  } catch {
    return undefined;
  }
}

/** Auth: required. Success: this user's active sessions/devices, each flagged isCurrent. */
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const { userId } = requireAuth(request);
    const sessions = await listActiveSessions(userId, currentJtiFrom(request));
    return apiSuccess(sessions);
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * Auth: required. "Log out of all OTHER devices" — the session making this
 * request is kept alive. To also end the current session, call
 * POST /api/v1/auth/logout afterwards.
 */
export async function DELETE(request: NextRequest) {
  try {
    await connectToDatabase();
    const { userId } = requireAuth(request);
    await revokeAllSessions(userId, currentJtiFrom(request));
    return apiSuccess(null, { message: "از سایر دستگاه‌ها خارج شدید" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
