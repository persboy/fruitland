import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { translateMapError } from "@/lib/server/maps/apiError";
import { reverseGeocodeQuerySchema } from "@/lib/server/maps/apiSchemas";
import { createMapService } from "@/lib/server/maps/service";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/maps/reverse-geocode?lat&lng&provider?
 * Auth: any signed-in user (interim default — see CLAUDE.md "ambiguity" note; not yet role-restricted).
 * Success: ReverseGeocodeResult (shared type). Errors: see maps/apiError.ts.
 */
export async function GET(request: NextRequest) {
  try {
    requireAuth(request);
    const { latitude, longitude, provider } = parseQuery(request, reverseGeocodeQuerySchema);
    const result = await createMapService({ provider }).reverseGeocode({ latitude, longitude });
    return apiSuccess(result);
  } catch (err) {
    return apiErrorFromException(translateMapError(err));
  }
}
