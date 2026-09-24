import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getShippingSettings, updateShippingSettings } from "@/lib/server/services/settingsService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { shippingSettingsSchema } from "@/lib/server/validation/adminSchemas";

/**
 * The single source of truth for the express delivery fee and the
 * free-delivery threshold (Project Instructions §8). Integer Toman only.
 * GET → { expressDeliveryFee|null, freeDeliveryThreshold|null, isConfigured }.
 */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    await connectToDatabase();
    return apiSuccess(await getShippingSettings());
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** PUT /api/v1/admin/settings/shipping — Auth: admin/master_admin. Body: { expressDeliveryFee, freeDeliveryThreshold }. Audited. */
export async function PUT(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, shippingSettingsSchema);
    await connectToDatabase();
    return apiSuccess(await updateShippingSettings(userId, input), { message: "تنظیمات ارسال ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
