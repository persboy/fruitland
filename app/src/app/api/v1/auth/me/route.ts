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
    const user = await User.findById(userId);
    if (!user) {
      throw AppError.notFound("کاربر یافت نشد", "USER_NOT_FOUND");
    }
    return apiSuccess(user.toJSON());
  } catch (err) {
    return apiErrorFromException(err);
  }
}
