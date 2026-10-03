import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { recordPhysicalReturn } from "@/lib/server/services/emergencyCancelService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { recordPhysicalReturnSchema } from "@/lib/server/validation/emergencyCancelSchemas";

/**
 * POST /api/v1/emergency-cancel-requests/[id]/physical-return
 * Auth: admin/master_admin. Body: { returned: boolean }.
 * Purely informational (Phase 14) — never blocks or reopens anything, and
 * only valid once the request has been approved.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireAdmin(request);
    const { returned } = await parseJsonBody(request, recordPhysicalReturnSchema);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await recordPhysicalReturn(actor, id, returned));
  } catch (err) {
    return apiErrorFromException(err);
  }
}
