import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getStoreSettings, updateStoreSettings } from "@/lib/server/services/settingsService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { storeSettingsSchema } from "@/lib/server/validation/adminSchemas";

/** GET /api/v1/admin/settings/store — Auth: admin/master_admin. Returns { storeName, supportPhone, address, isConfigured }. */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    await connectToDatabase();
    return apiSuccess(await getStoreSettings());
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** PUT /api/v1/admin/settings/store — Auth: admin/master_admin. Body: { storeName, supportPhone, address }. Audited. */
export async function PUT(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, storeSettingsSchema);
    await connectToDatabase();
    return apiSuccess(await updateStoreSettings(userId, input), { message: "اطلاعات فروشگاه ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
