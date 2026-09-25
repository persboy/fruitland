import {
  isValidCoordinates,
  type Coordinates,
  type GeocodeResult,
  type MapResultMeta,
  type PlaceResult,
  type ReverseGeocodeResult,
  type RouteResult,
} from "@fruitland/shared";
import type { VehicleType } from "@fruitland/shared";
import { MapProviderError, mapError, unsupportedOperation, type MapOperation } from "../errors";
import { requestJson } from "../http";
import { decodePolylineToGeoJson } from "../polyline";
import type { MapCapabilities, MapProvider, RouteOptions, SearchPlacesOptions } from "../provider";

/**
 * Neshan adapter. Endpoints/params/response shapes below are taken from the
 * official docs (platform.neshan.org, checked 2026-09-24):
 *   reverse  GET https://api.neshan.org/v5/reverse?lat&lng
 *   search   GET https://api.neshan.org/v1/search?term&lat&lng   (lat/lng reference point is REQUIRED by Neshan)
 *   route    GET https://api.neshan.org/v4/direction?type=car&origin=lat,lng&destination=lat,lng
 * Auth: `Api-Key` header. Errors arrive as HTTP status 470/480/481/482/483.
 *
 * NOT implemented (capability=false), see docs/maps capability matrix:
 *   geocode     — Neshan offers a Geocoding API but its endpoint/response were not verifiable yet; not guessed.
 *   routeMatrix — optional capability, off for the MVP.
 */
const BASE_URL = "https://api.neshan.org";

export const NESHAN_CAPABILITIES: MapCapabilities = {
  reverseGeocode: true,
  geocode: false,
  searchPlaces: true,
  getRoute: true,
  routeMatrix: false,
};

export interface NeshanProviderOptions {
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface NeshanReverseResponse {
  status?: string;
  formatted_address?: string | null;
  route_name?: string | null;
  neighbourhood?: string | null;
  city?: string | null;
  state?: string | null;
  municipality_zone?: string | null;
}

interface NeshanSearchItem {
  title?: string;
  address?: string;
  category?: string;
  type?: string;
  poiHash?: string;
  location?: { x?: number; y?: number };
}

interface NeshanDirectionResponse {
  routes?: {
    overview_polyline?: { points?: string };
    legs?: { distance?: { value?: number }; duration?: { value?: number } }[];
  }[];
}

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class NeshanProvider implements MapProvider {
  readonly name = "neshan" as const;
  readonly capabilities = NESHAN_CAPABILITIES;

  constructor(private readonly options: NeshanProviderOptions) {}

  private meta(providerPlaceId: string | null = null): MapResultMeta {
    return { provider: "neshan", providerPlaceId, resolvedAt: new Date().toISOString() };
  }

  private get(operation: MapOperation, path: string, query: string): Promise<unknown> {
    return requestJson({
      provider: "neshan",
      operation,
      url: `${BASE_URL}${path}?${query}`,
      headers: { "Api-Key": this.options.apiKey },
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      mapHttpError: (status) => this.mapNeshanStatus(operation, status),
    });
  }

  /** Neshan's documented error codes (sent as the HTTP status). */
  private mapNeshanStatus(operation: MapOperation, status: number): MapProviderError | null {
    switch (status) {
      case 470: // CoordinateParseError
        return mapError("neshan", operation, "INVALID_REQUEST", "Neshan rejected the coordinates");
      case 480: // KeyNotFound — invalid key or missing Api-Key header
        return mapError("neshan", operation, "AUTH_FAILED");
      case 481: // LimitExceeded — quota used up: retrying cannot help
        return new MapProviderError({
          provider: "neshan",
          operation,
          code: "RATE_LIMIT",
          message: "Neshan usage limit exceeded",
          retryable: false,
        });
      case 482: // RateExceeded — per-minute rate
        return mapError("neshan", operation, "RATE_LIMIT", "Neshan per-minute rate limit exceeded");
      case 483: // ApiKeyTypeError
        return mapError(
          "neshan",
          operation,
          "AUTH_FAILED",
          "Neshan API key type does not match this service (use the Web Service key, not the Web Map key)",
        );
      default:
        return null;
    }
  }

  private assertCoordinates(operation: MapOperation, ...points: Coordinates[]) {
    if (!points.every(isValidCoordinates)) throw mapError("neshan", operation, "INVALID_REQUEST", "Invalid coordinates");
  }

  async reverseGeocode(coordinates: Coordinates): Promise<ReverseGeocodeResult> {
    this.assertCoordinates("reverseGeocode", coordinates);
    const body = await this.get("reverseGeocode", "/v5/reverse", `lat=${coordinates.latitude}&lng=${coordinates.longitude}`);
    if (!isRecord(body)) throw mapError("neshan", "reverseGeocode", "INVALID_RESPONSE");
    const data = body as NeshanReverseResponse;

    if (data.status !== "OK") throw mapError("neshan", "reverseGeocode", "NO_RESULT");
    const formattedAddress = nonEmpty(data.formatted_address);
    if (!formattedAddress) throw mapError("neshan", "reverseGeocode", "NO_RESULT");

    const state = nonEmpty(data.state);
    const zone = nonEmpty(data.municipality_zone);
    return {
      address: {
        // Neshan sometimes prefixes the province with "استان " — dropped so providers compare equally.
        province: state ? state.replace(/^استان\s+/, "") : null,
        city: nonEmpty(data.city),
        district: zone ? `منطقه ${zone}` : null, // municipal zone number
        neighborhood: nonEmpty(data.neighbourhood),
        street: nonEmpty(data.route_name),
        // Neshan's reverse API does not return these — explicit null, never guessed.
        alley: null,
        plaque: null,
        unit: null,
        postalCode: null,
        formattedAddress,
        coordinates,
      },
      meta: this.meta(),
    };
  }

  async geocode(_address: string): Promise<GeocodeResult[]> {
    void _address;
    throw mapError(
      "neshan",
      "geocode",
      "UNSUPPORTED_OPERATION",
      "Neshan geocoding is not implemented yet (its API details are pending verification)",
    );
  }

  async searchPlaces(query: string, options?: SearchPlacesOptions): Promise<PlaceResult[]> {
    const term = query.trim();
    if (!term) throw mapError("neshan", "searchPlaces", "INVALID_REQUEST", "Empty search query");
    if (!options?.near) {
      throw mapError("neshan", "searchPlaces", "INVALID_REQUEST", "Neshan search needs a reference point (options.near)");
    }
    this.assertCoordinates("searchPlaces", options.near);

    const body = await this.get(
      "searchPlaces",
      "/v1/search",
      `term=${encodeURIComponent(term)}&lat=${options.near.latitude}&lng=${options.near.longitude}`,
    );
    if (!isRecord(body) || !Array.isArray(body.items)) throw mapError("neshan", "searchPlaces", "INVALID_RESPONSE");

    const places: PlaceResult[] = [];
    for (const item of body.items as NeshanSearchItem[]) {
      const name = nonEmpty(item?.title);
      // Neshan: location.x = longitude, location.y = latitude.
      const point = { latitude: item?.location?.y, longitude: item?.location?.x };
      if (!name || !isValidCoordinates(point)) continue; // skip unusable rows instead of inventing data
      const id = nonEmpty(item.poiHash);
      places.push({
        id,
        name,
        coordinates: point,
        address: nonEmpty(item.address),
        category: nonEmpty(item.type) ?? nonEmpty(item.category),
        meta: this.meta(id),
      });
    }
    return options.limit ? places.slice(0, options.limit) : places;
  }

  /** Neshan's /v4/direction `type` parameter. Neshan does not offer a bicycle profile. */
  private static readonly VEHICLE_TYPE_MAP: Partial<Record<VehicleType, "car" | "motorcycle">> = {
    car: "car",
    motorcycle: "motorcycle",
  };

  async getRoute(origin: Coordinates, destination: Coordinates, options?: RouteOptions): Promise<RouteResult> {
    this.assertCoordinates("getRoute", origin, destination);
    const requested = options?.vehicleType ?? "car"; // caller decides; "car" is only the fallback when unspecified
    const neshanType = NeshanProvider.VEHICLE_TYPE_MAP[requested];
    if (!neshanType) throw unsupportedOperation("neshan", "getRoute");
    const body = await this.get(
      "getRoute",
      "/v4/direction",
      `type=${neshanType}&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}`,
    );
    if (!isRecord(body)) throw mapError("neshan", "getRoute", "INVALID_RESPONSE");

    const route = (body as NeshanDirectionResponse).routes?.[0];
    if (!route) throw mapError("neshan", "getRoute", "NO_RESULT", "Neshan found no route between the points");
    const legs = route.legs ?? [];
    const distance = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? Number.NaN), 0);
    const duration = legs.reduce((sum, leg) => sum + (leg.duration?.value ?? Number.NaN), 0);
    if (legs.length === 0 || !Number.isFinite(distance) || !Number.isFinite(duration)) {
      throw mapError("neshan", "getRoute", "INVALID_RESPONSE");
    }

    const points = route.overview_polyline?.points;
    const includeGeometry = options?.includeGeometry !== false;
    const line = includeGeometry && points ? decodePolylineToGeoJson(points) : [];
    return {
      distanceMeters: Math.round(distance),
      durationSeconds: Math.round(duration),
      origin,
      destination,
      geometry: line.length >= 2 ? { type: "LineString", coordinates: line } : null,
      meta: this.meta(),
    };
  }
}

