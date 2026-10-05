import type { NextRequest } from "next/server";
import { updateSiteContentPageSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { updateSiteContentPage } from "@/lib/server/services/siteContentService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * PATCH /api/v1/admin/site-content/pages/[slug] — Auth: admin/master_admin. Body: partial { title, body, isPublished }
 * (plain text only; HTML is rejected). The page set is fixed: 404 SITE_PAGE_NOT_FOUND for any other slug. The first
 * save of a page needs title + body (400 SITE_PAGE_CONTENT_REQUIRED); 409 SITE_PAGE_SLUG_TAKEN if a concurrent first
 * save won. Audited. No POST/DELETE exists: pages cannot be created freely or removed.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { slug } = await params;
    const input = await parseJsonBody(request, updateSiteContentPageSchema);
    await connectToDatabase();
    return apiSuccess(await updateSiteContentPage(userId, slug, input), { message: "صفحه ذخیره شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
