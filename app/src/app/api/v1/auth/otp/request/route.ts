import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requestLoginOtp } from "@/lib/server/services/authService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { requestOtpSchema } from "@/lib/server/validation/authSchemas";

/**
 * Auth: none. Body: { phone }. Side effects: sends (or, in dev, logs) an
 * OTP SMS; rate-limited/cooldown-limited per phone (see otpService.ts).
 * Success: { phone, isNewUser }. isNewUser only tells the client whether to
 * show a "welcome, want a referral code?" field — not sensitive (the phone
 * itself is verified by the same OTP, not a secret).
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { phone } = await parseJsonBody(request, requestOtpSchema);
    const result = await requestLoginOtp(phone);
    return apiSuccess(result);
  } catch (err) {
    return apiErrorFromException(err);
  }
}
