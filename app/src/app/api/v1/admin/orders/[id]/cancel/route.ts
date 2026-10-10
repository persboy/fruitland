import type { NextRequest } from "next/server";
import { cancelOrderSchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { cancelOrder } from "@/lib/server/services/orderService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/orders/[id]/cancel — Auth: admin/master_admin. Body: { reason } (mandatory, trimmed, ≤ 500; any other key → 400).
 * Ordinary cancellation only: the order must be `preparing` AND not in a delivery run (`delivery.status = unassigned`), enforced by one
 * conditional write. 404 ORDER_NOT_FOUND; 409 ORDER_ALREADY_CANCELLED | ORDER_NOT_CANCELLABLE | ORDER_IN_DELIVERY. Audited as `order.cancelled`.
 * Never touches DeliveryRun, payment fields or discount usage.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { userId } = requireAdmin(request);
    const { id } = await params;
    const { reason } = await parseJsonBody(request, cancelOrderSchema);
    await connectToDatabase();
    return apiSuccess(await cancelOrder(userId, id, reason), { message: "سفارش لغو شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
