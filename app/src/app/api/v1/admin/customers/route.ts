import type { NextRequest } from "next/server";
import { customerListQuerySchema } from "@fruitland/shared";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth/guard";
import { listCustomers } from "@/lib/server/services/customerService";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/admin/customers?page&limit&search&status — Auth: admin/master_admin. Only role=customer users (not
 * overridable by the client). page ≥ 1; limit 1–100 (default 20); search ≤ 50 chars over phone/firstName/lastName;
 * status active|inactive|all (default all). Newest first. Response: DTO list + envelope `pagination {page,pageSize,total}`.
 */
export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    const query = parseQuery(request, customerListQuerySchema);
    await connectToDatabase();
    const { items, pagination } = await listCustomers(query);
    return apiSuccess(items, { pagination });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
