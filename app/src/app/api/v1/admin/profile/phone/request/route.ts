import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { requestOwnPhoneChange } from "@/lib/server/services/profileService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { requestPhoneChangeSchema } from "@/lib/server/validation/adminSchemas";

/** POST /api/v1/admin/profile/phone/request — Auth: admin/master_admin. Body: { newPhone }. Sends an OTP to the NEW number. */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const { newPhone } = await parseJsonBody(request, requestPhoneChangeSchema);
    await connectToDatabase();
    await requestOwnPhoneChange(userId, newPhone);
    return apiSuccess(null, { message: "کد تأیید برای شماره‌ی جدید ارسال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
