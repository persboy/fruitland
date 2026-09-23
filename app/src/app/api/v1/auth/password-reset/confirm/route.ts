import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { resetPasswordWithOtp } from "@/lib/server/services/authService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { passwordResetConfirmSchema } from "@/lib/server/validation/authSchemas";

/**
 * Auth: none (the OTP code is the credential). Body: { phone, code,
 * newPassword }. Side effects: sets the new password hash and revokes
 * every existing session for the account (all devices must log in again).
 * Errors: OTP_NOT_REQUESTED / OTP_EXPIRED / OTP_INVALID / OTP_LOCKED.
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { phone, code, newPassword } = await parseJsonBody(request, passwordResetConfirmSchema);
    await resetPasswordWithOtp(phone, code, newPassword);
    return apiSuccess(null, { message: "رمز عبور با موفقیت تغییر کرد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
