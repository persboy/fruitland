import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requestPasswordResetOtp } from "@/lib/server/services/authService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { requestOtpSchema } from "@/lib/server/validation/authSchemas";

/**
 * Auth: none. Body: { phone }. Always returns the same generic success
 * message — a code is only actually sent when `phone` belongs to an active
 * admin/master_admin account (see authService.requestPasswordResetOtp),
 * but the response never reveals which case happened (prevents phone/role
 * enumeration).
 */
export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { phone } = await parseJsonBody(request, requestOtpSchema);
    await requestPasswordResetOtp(phone);
    return apiSuccess(null, {
      message: "اگر این شماره متعلق به یک حساب مدیریتی باشد، کد بازیابی رمز عبور ارسال شد",
    });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
