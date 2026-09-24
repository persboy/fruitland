import { z } from "zod";

/**
 * Map domain (Phase 4.5 / maps Phase 2).
 *
 * These are the ONLY map shapes the rest of the app may know. Provider-specific
 * responses (Neshan / Map.ir / Google) are converted to these inside each
 * provider adapter and never leave it (docs: MASTER map prompt §3, §47).
 *
 * Convention: a value a provider could not supply is an explicit `null`, never
 * a guess and never a copy of another field (e.g. `street` is NOT filled from
 * `formattedAddress`).
 */

export const MAP_PROVIDER_NAMES = ["neshan", "mapir", "google"] as const;
export type MapProviderName = (typeof MAP_PROVIDER_NAMES)[number];

// ---------------------------------------------------------------- Coordinates

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Range check only. Service-area rules (e.g. "Zanjan only") belong to the business layer, not here. */
export const coordinatesSchema = z.object({
  latitude: z.number({ invalid_type_error: "عرض جغرافیایی باید عدد باشد", required_error: "عرض جغرافیایی الزامی است" })
    .finite()
    .min(-90, "عرض جغرافیایی نامعتبر است")
    .max(90, "عرض جغرافیایی نامعتبر است"),
  longitude: z.number({ invalid_type_error: "طول جغرافیایی باید عدد باشد", required_error: "طول جغرافیایی الزامی است" })
    .finite()
    .min(-180, "طول جغرافیایی نامعتبر است")
    .max(180, "طول جغرافیایی نامعتبر است"),
});

export function isValidCoordinates(value: unknown): value is Coordinates {
  return coordinatesSchema.safeParse(value).success;
}

// -------------------------------------------------------------------- Address

export interface NormalizedAddress {
  province: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  street: string | null;
  alley: string | null;
  plaque: string | null;
  unit: string | null;
  postalCode: string | null;
  formattedAddress: string;
  coordinates: Coordinates;
}

/** Where a result came from — provenance only, never used by business logic. */
export interface MapResultMeta {
  provider: MapProviderName;
  providerPlaceId: string | null;
  /** ISO-8601 UTC */
  resolvedAt: string;
}

// ------------------------------------------------------------ Result shapes

export interface ReverseGeocodeResult {
  address: NormalizedAddress;
  meta: MapResultMeta;
}

export interface GeocodeResult {
  coordinates: Coordinates;
  formattedAddress: string;
  /** Structured parts when the provider returns them, otherwise null. */
  address: NormalizedAddress | null;
  meta: MapResultMeta;
}

export interface PlaceResult {
  id: string | null;
  name: string;
  coordinates: Coordinates;
  address: string | null;
  category: string | null;
  meta: MapResultMeta;
}

/** GeoJSON LineString: `coordinates` are [longitude, latitude] pairs (GeoJSON order, unlike `Coordinates`). */
export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  origin: Coordinates;
  destination: Coordinates;
  /** null when the provider returns no usable geometry. */
  geometry: RouteGeometry | null;
  meta: MapResultMeta;
}

/**
 * origins × destinations grid. A cell is null when the provider could not
 * route that pair — never 0, which would look like "same place". Row i /
 * column j corresponds to origins[i] / destinations[j].
 */
export interface RouteMatrixCell {
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export interface RouteMatrixResult {
  rows: RouteMatrixCell[][];
  meta: MapResultMeta;
}

// ------------------------------------------------------------------ Requests

export const routeRequestSchema = z.object({
  origin: coordinatesSchema,
  destination: coordinatesSchema,
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;
