import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { translateMapError } from "@/lib/server/maps/apiError";
import { geocodeQuerySchema } from "@/lib/server/maps/apiSchemas";
import { createMapService } from "@/lib/server/maps/service";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/maps/geocode?address&provider?
 * Auth: any signed-in user (interim default — see CLAUDE.md). Success: GeocodeResult[].
 */
export async function GET(request: NextRequest) {
  try {
    requireAuth(request);
    const { address, provider } = parseQuery(request, geocodeQuerySchema);
    const results = await createMapService({ provider }).geocode(address);
    return apiSuccess(results);
  } catch (err) {
    return apiErrorFromException(translateMapError(err));
  }
}
