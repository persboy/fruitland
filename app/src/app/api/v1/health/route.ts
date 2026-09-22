import { apiError, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";

export async function GET() {
  try {
    const mongooseInstance = await connectToDatabase();
    const dbState = mongooseInstance.connection.readyState; // 1 = connected

    return apiSuccess({
      status: "ok",
      db: dbState === 1 ? "connected" : "not_connected",
    });
  } catch {
    return apiError("HEALTH_CHECK_FAILED", "خطا در اتصال به دیتابیس", 503);
  }
}
