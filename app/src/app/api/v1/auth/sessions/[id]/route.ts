import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAuth } from "@/lib/server/auth/guard";
import { revokeSession } from "@/lib/server/services/authService";

/** Auth: required. Path param: session id (a RefreshToken document id). Ownership: only the session's own user may revoke it — enforced in authService.revokeSession. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectToDatabase();
    const { userId } = requireAuth(request);
    const { id } = await params;
    await revokeSession(userId, id);
    return apiSuccess(null, { message: "نشست باطل شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
