import type { NextRequest } from "next/server";
import { faqStatusSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { setFaqActive } from "@/lib/server/services/faqService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/site-content/faqs/[id]/status — Auth: admin/master_admin. Body: { isActive: boolean } (explicit set, not a toggle).
 * The only way to activate/deactivate (no hard delete exists). 404 FAQ_NOT_FOUND. Audited only when the state actually changes.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { isActive } = await parseJsonBody(request, faqStatusSchema);
    await connectToDatabase();
    return apiSuccess(await setFaqActive(userId, id, isActive), { message: isActive ? "سؤال متداول فعال شد" : "سؤال متداول غیرفعال شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
