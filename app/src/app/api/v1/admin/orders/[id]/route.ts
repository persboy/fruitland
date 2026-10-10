import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getOrder } from "@/lib/server/services/orderService";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/v1/admin/orders/[id] — Auth: admin/master_admin. Read-only OrderDetailDto (stored snapshots; no courier location). 404 ORDER_NOT_FOUND for a missing or malformed id. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await getOrder(id));
  } catch (err) {
    return apiErrorFromException(err);
  }
}
