import type { NextRequest } from "next/server";
import { updateSlideSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { updateSlide } from "@/lib/server/services/slideService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/site-content/slides/[id] — Auth: admin/master_admin. Body: partial update (at least one field; "" clears optional text/links).
 * `isActive` is NOT editable here (see …/status). 404 SLIDE_NOT_FOUND (also for a malformed id). Audited. There is intentionally no DELETE: deactivate instead.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const input = await parseJsonBody(request, updateSlideSchema);
    await connectToDatabase();
    return apiSuccess(await updateSlide(userId, id, input), { message: "اسلاید ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
