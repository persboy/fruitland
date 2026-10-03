import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAuth } from "@/lib/server/auth/guard";
import { requestEmergencyCancel } from "@/lib/server/services/emergencyCancelService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { requestEmergencyCancelSchema } from "@/lib/server/validation/emergencyCancelSchemas";

/**
 * POST /api/v1/delivery-runs/[id]/emergency-cancel
 * Auth: courier, and only for their own active run (enforced inside the
 * service — see requestEmergencyCancel). Body: { reason }.
 * Does not change the run or any order; only records a pending request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireAuth(request);
    const { reason } = await parseJsonBody(request, requestEmergencyCancelSchema);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await requestEmergencyCancel(actor, id, reason), { status: 201 });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
