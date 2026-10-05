import type { NextRequest } from "next/server";
import { updateSocialLinksSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getSocialLinks, updateSocialLinks } from "@/lib/server/services/settingsService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

/** GET /api/v1/admin/site-content/social-links — Auth: admin/master_admin. Returns { instagram, telegram, whatsapp } ("" = not set). */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    await connectToDatabase();
    return apiSuccess(await getSocialLinks());
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/**
 * PATCH /api/v1/admin/site-content/social-links — Auth: admin/master_admin. Body: partial { instagram, telegram, whatsapp }
 * (http(s) URLs; "" clears one). Stored on StoreSettings.socialLinks without touching any other Settings field and without
 * making the store "configured". Audited when something changes.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, updateSocialLinksSchema);
    await connectToDatabase();
    return apiSuccess(await updateSocialLinks(userId, input), { message: "لینک‌های شبکه‌های اجتماعی ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
