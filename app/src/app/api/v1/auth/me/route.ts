import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAuth } from "@/lib/server/auth/guard";
import { AppError } from "@/lib/server/errors/AppError";
import { User } from "@/lib/server/models/User";

/** Auth: required (any role). Success: the current user's own record (password fields always stripped, see User.ts toJSON). */
export async function GET(request: NextRequest) {
  try {
    await connectToDatabase();
    const { userId } = requireAuth(request);
    const user = await User.findById(userId).select("+passwordHash");
    if (!user) {
      throw AppError.notFound("کاربر یافت نشد", "USER_NOT_FOUND");
    }
    // hasPassword lets the UI know whether changing the password needs the current one; the hash itself never leaves (see User.ts toJSON).
    return apiSuccess({ ...user.toJSON(), hasPassword: Boolean(user.passwordHash) });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
