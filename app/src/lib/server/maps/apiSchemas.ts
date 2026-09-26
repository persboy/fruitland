import { z } from "zod";
import { MAP_PROVIDER_NAMES, VEHICLE_TYPES, coordinatesSchema, routeRequestSchema } from "@fruitland/shared";

/** Optional explicit provider override, shared by every map endpoint (query or body). Unknown value → 400, never a silent fallback. */
const providerSchema = z.enum(MAP_PROVIDER_NAMES, { errorMap: () => ({ message: "provider نامعتبر است" }) }).optional();

/** Re-runs the shared coordinatesSchema (single source of truth for range/messages) against an already-numeric point, attaching any issue to `path`. */
function validateCoordinates(ctx: z.RefinementCtx, point: { latitude: number; longitude: number }, path: (string | number)[]) {
  const result = coordinatesSchema.safeParse(point);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ ...issue, path });
  }
}

export const reverseGeocodeQuerySchema = z
  .object({
    lat: z.string({ required_error: "lat الزامی است" }),
    lng: z.string({ required_error: "lng الزامی است" }),
    provider: providerSchema,
  })
  .transform(({ lat, lng, provider }) => ({ latitude: Number(lat), longitude: Number(lng), provider }))
  .superRefine((v, ctx) => validateCoordinates(ctx, v, ["lat"]));

export const geocodeQuerySchema = z.object({
  address: z.string({ required_error: "address الزامی است" }).trim().min(1, "address الزامی است"),
  provider: providerSchema,
});

export const searchQuerySchema = z
  .object({
    query: z.string({ required_error: "query الزامی است" }).trim().min(1, "query الزامی است"),
    lat: z.string().optional(),
    lng: z.string().optional(),
    limit: z.coerce.number().int().positive().max(20).optional(),
    provider: providerSchema,
  })
  .transform(({ lat, lng, ...rest }) => ({
    ...rest,
    near: lat !== undefined && lng !== undefined ? { latitude: Number(lat), longitude: Number(lng) } : undefined,
    // Kept only so superRefine below can tell "one given, one missing" apart from "both given but invalid".
    _lat: lat,
    _lng: lng,
  }))
  .superRefine((v, ctx) => {
    if ((v._lat === undefined) !== (v._lng === undefined)) {
      ctx.addIssue({ code: "custom", message: "lat و lng باید هر دو یا هیچ‌کدام داده شوند", path: ["lat"] });
      return;
    }
    if (v.near) validateCoordinates(ctx, v.near, ["lat"]);
  })
  .transform((v) => ({ query: v.query, near: v.near, limit: v.limit, provider: v.provider }));

export const routeBodySchema = routeRequestSchema.extend({
  provider: providerSchema,
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  includeGeometry: z.boolean().optional(),
});

// Capped at 25 points per side — a validation bound on payload shape, not application rate limiting (that's a later phase).
const MAX_MATRIX_POINTS = 25;
export const routeMatrixBodySchema = z.object({
  origins: z.array(coordinatesSchema).min(1, "origins نمی‌تواند خالی باشد").max(MAX_MATRIX_POINTS, `origins حداکثر ${MAX_MATRIX_POINTS} نقطه`),
  destinations: z.array(coordinatesSchema).min(1, "destinations نمی‌تواند خالی باشد").max(MAX_MATRIX_POINTS, `destinations حداکثر ${MAX_MATRIX_POINTS} نقطه`),
  provider: providerSchema,
});
