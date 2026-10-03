import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { reviewEmergencyCancelRequest } from "@/lib/server/services/emergencyCancelService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { reviewEmergencyCancelSchema } from "@/lib/server/validation/emergencyCancelSchemas";

/**
 * POST /api/v1/emergency-cancel-requests/[id]/review
 * Auth: admin/master_admin. Body: { decision: "approve"|"reject", rejectionReason? }.
 * Approval is transactional and all-or-nothing (see reviewEmergencyCancelRequest);
 * re-submitting the same decision on an already-reviewed request is a safe no-op.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireAdmin(request);
    const { decision, rejectionReason } = await parseJsonBody(request, reviewEmergencyCancelSchema);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await reviewEmergencyCancelRequest(actor, id, decision, rejectionReason));
  } catch (err) {
    return apiErrorFromException(err);
  }
}
