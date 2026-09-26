import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { translateMapError } from "@/lib/server/maps/apiError";
import { routeMatrixBodySchema } from "@/lib/server/maps/apiSchemas";
import { createMapService } from "@/lib/server/maps/service";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

/**
 * POST /api/v1/maps/route-matrix — Body: { origins[], destinations[], provider? }
 * Auth: any signed-in user (interim default — see CLAUDE.md). Success: RouteMatrixResult.
 * Not yet called by any business logic (MASTER-PROMPT map spec §63); exposed here only
 * because MapService/Provider already support it and hiding a working capability
 * would be inconsistent with the rest of the API surface.
 */
export async function POST(request: NextRequest) {
  try {
    requireAuth(request);
    const { origins, destinations, provider } = await parseJsonBody(request, routeMatrixBodySchema);
    const result = await createMapService({ provider }).getRouteMatrix(origins, destinations);
    return apiSuccess(result);
  } catch (err) {
    return apiErrorFromException(translateMapError(err));
  }
}
