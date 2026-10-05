import type { NextRequest } from "next/server";
import { createFaqSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { createFaq, listFaqs } from "@/lib/server/services/faqService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

/** GET /api/v1/admin/site-content/faqs — Auth: admin/master_admin. Every FAQ items (active and inactive) ordered by sortOrder, _id. Not paginated (small admin-managed list). */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    await connectToDatabase();
    return apiSuccess(await listFaqs());
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** POST /api/v1/admin/site-content/faqs — Auth: admin/master_admin. Always created active (isActive is not accepted). Audited. */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAdmin(request);
    const input = await parseJsonBody(request, createFaqSchema);
    await connectToDatabase();
    return apiSuccess(await createFaq(userId, input), { message: "سؤال متداول ایجاد شد", status: 201 });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
