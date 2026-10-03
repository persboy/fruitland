import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAuth } from "@/lib/server/auth/guard";
import { getEmergencyCancelRequest } from "@/lib/server/services/emergencyCancelService";

/**
 * GET /api/v1/emergency-cancel-requests/[id]
 * Auth: admin/master_admin (any request) or the requesting courier (their
 * own only — enforced inside the service; anyone else's request is a 404,
 * not a 403, same pattern as DeliveryRun ownership).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = requireAuth(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getEmergencyCancelRequest(actor, id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}
