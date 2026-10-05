import type { NextRequest } from "next/server";
import { slideStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setSlideActive } from "@/lib/server/services/slideService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/site-content/slides/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle).
 * The only way to activate/deactivate (no hard delete exists). 404 SLIDE_NOT_FOUND. Audited only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, slideStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setSlideActive(userId, id, isActive), { message: isActive ? "اسلاید فعال شد" : "اسلاید غیرفعال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
