import type { NextRequest } from "next/server";
import { orderListQuerySchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { listOrders } from "@/lib/server/services/orderService";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/admin/orders?page&limit&search&status&deliveryStatus&source — Auth: admin/master_admin.
 * page ≥ 1; limit 1–100 (default 20); search ≤ 50 chars = order-number prefix OR customer name/phone;
 * status = Order.status; deliveryStatus = Order.delivery.status; source = online|phone (unknown values → 400).
 * Newest first. Response: OrderListItemDto[] + envelope `pagination {page,pageSize,total}`.
 */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const query = parseQuery(request, orderListQuerySchema);
    await connectToDatabase();
    const { items, pagination } = await listOrders(query);
    return apiSuccess(items, { pagination });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
