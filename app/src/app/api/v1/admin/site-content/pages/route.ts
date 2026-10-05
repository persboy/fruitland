import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { listSiteContentPages } from "@/lib/server/services/siteContentService";

/** GET /api/v1/admin/site-content/pages — Auth: admin/master_admin. Always returns the fixed pages (about, terms); a never-saved page has exists:false. */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    await connectToDatabase();
    return apiSuccess(await listSiteContentPages());
  } catch (err) {
    return apiErrorFromException(err);
  }
}
