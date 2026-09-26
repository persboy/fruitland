import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { connectToDatabase } from "@/lib/server/db";
import { createAddress, listAddresses } from "@/lib/server/services/addressService";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";
import { createAddressSchema } from "@/lib/server/validation/addressSchemas";

/** GET /api/v1/addresses — Auth: required. Returns the CURRENT user's own addresses only. */
export async function GET(request: NextRequest) {
  try {
    const { userId } = requireAuth(request);
    await connectToDatabase();
    return apiSuccess(await listAddresses(userId));
  } catch (err) {
    return apiErrorFromException(err);
  }
}

/** POST /api/v1/addresses — Auth: required. Body: CreateAddressInput. Creates an address owned by the current user. */
export async function POST(request: NextRequest) {
  try {
    const { userId } = requireAuth(request);
    const input = await parseJsonBody(request, createAddressSchema);
    await connectToDatabase();
    return apiSuccess(await createAddress(userId, input), { message: "آدرس ثبت شد" });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
