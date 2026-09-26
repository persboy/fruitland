import type { NextRequest } from "next/server";
import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { requireAuth } from "@/lib/server/auth/guard";
import { translateMapError } from "@/lib/server/maps/apiError";
import { routeBodySchema } from "@/lib/server/maps/apiSchemas";
import { createMapService } from "@/lib/server/maps/service";
import { parseJsonBody } from "@/lib/server/validation/parseJsonBody";

/**
 * POST /api/v1/maps/route — Body: { origin, destination, provider?, vehicleType?, includeGeometry? }
 * Auth: any signed-in user (interim default — see CLAUDE.md). Success: RouteResult.
 */
export async function POST(request: NextRequest) {
  try {
    requireAuth(request);
    const { origin, destination, provider, vehicleType, includeGeometry } = await parseJsonBody(request, routeBodySchema);
    const result = await createMapService({ provider }).getRoute(origin, destination, { vehicleType, includeGeometry });
    return apiSuccess(result);
  } catch (err) {
    return apiErrorFromException(translateMapError(err));
  }
}
