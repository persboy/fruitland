import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { connectToDatabase } from "@/lib/server/db";
import { setDefaultAddress } from "@/lib/server/services/addressService";

/** POST /api/v1/addresses/[id]/default — Auth: required. Makes this address the user's default and every other one not-default. Same ownership rule as GET /addresses/[id]. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = requireAuth(request);
    const { id } = await params;
    await connectToDatabase();
    return apiSuccess(await setDefaultAddress(userId, id), { message: "آدرس پیش‌فرض تغییر کرد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
