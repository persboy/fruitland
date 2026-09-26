import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { translateMapError } from "@/lib/server/maps/apiError";
import { searchQuerySchema } from "@/lib/server/maps/apiSchemas";
import { createMapService } from "@/lib/server/maps/service";
import { parseQuery } from "@/lib/server/validation/parseQuery";

/**
 * GET /api/v1/maps/search?query&lat?&lng?&limit?&provider?
 * Auth: any signed-in user (interim default — see CLAUDE.md). Success: PlaceResult[].
 */
export async function GET(request: NextRequest) {
  try {
    requireAuth(request);
    const { query, near, limit, provider } = parseQuery(request, searchQuerySchema);
    const results = await createMapService({ provider }).searchPlaces(query, { near, limit });
    return apiSuccess(results);
  } catch (err) {
    return apiErrorFromException(translateMapError(err));
  }
}
