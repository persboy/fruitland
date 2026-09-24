import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { confirmOwnPhoneChange } from "@/lib/server/services/profileService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { confirmPhoneChangeSchema } from "@/lib/server/validation/adminSchemas";

/** POST /api/v1/admin/profile/phone/confirm — Auth: admin/master_admin. Body: { newPhone, code }. Changes the phone (audited). */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const { newPhone, code } = await parseJsonBody(request, confirmPhoneChangeSchema);
    await connectToDatabase();
    const user = await confirmOwnPhoneChange(userId, newPhone, code);
    return apiSuccess(user.toJSON(), { message: "شماره‌ی موبایل تغییر کرد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
