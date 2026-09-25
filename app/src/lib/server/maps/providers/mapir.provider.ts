import {
  isValidCoordinates,
  type Coordinates,
  type GeocodeResult,
  type MapResultMeta,
  type PlaceResult,
  type ReverseGeocodeResult,
  type RouteResult,
} from "@fruitland/shared";
import { mapError, unsupportedOperation, type MapOperation } from "../errors";
import { requestJson } from "../http";
import type { MapCapabilities, MapProvider, RouteOptions, SearchPlacesOptions } from "../provider";

/**
 * Map.ir adapter. Verified against the official support/docs sites
 * (help.map.ir and corp.map.ir, checked 2026-09-25):
 *   reverse  GET https://map.ir/reverse/?lat&lon        (full; ~70ms, includes POI name if the point is a registered place)
 *   base URL confirmed by Map.ir's own Laravel package default: MAPIR_WEBSERVICE_URL=https://map.ir
 * Auth: `x-api-key` header (help.map.ir/reverse_api). Missing/invalid key → HTTP 401
 * (corp.map.ir/map-services/unauthorized) — Map.ir documents no custom error-code
 * scheme beyond that, so this adapter relies on the generic HTTP→error mapping
 * (401/403→AUTH_FAILED, 429→RATE_LIMIT, 5xx→PROVIDER_UNAVAILABLE) rather than
 * invented Map.ir-specific codes.
 *
 * NOT implemented (capability=false) — see docs/maps.md capability matrix:
 *   geocode (Search v1/v2), searchPlaces, getRoute, routeMatrix — Map.ir has
 *   official pages for all of these (help.map.ir: Search, Route, Distance
 *   Matrix, Places), but this session's fetches of those specific pages were
 *   blocked (robots.txt) and no full, field-by-field official response
 *   example could be verified for any of them, unlike Reverse. Per the "never
 *   guess an endpoint or response shape" rule, they are left UNSUPPORTED
 *   rather than implemented from third-party wrapper snippets.
 */
const BASE_URL = "https://map.ir";

export const MAPIR_CAPABILITIES: MapCapabilities = {
  reverseGeocode: true,
  geocode: false,
  searchPlaces: false,
  getRoute: false,
  routeMatrix: false,
};

export interface MapIrProviderOptions {
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface MapIrReverseResponse {
  address?: string;
  postal_address?: string;
  address_compact?: string;
  province?: string;
  city?: string;
  county?: string;
  region?: string;
  neighborhood?: string;
  primary?: string;
  plaque?: number | string | null;
  postal_code?: string | null;
}

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class MapIrProvider implements MapProvider {
  readonly name = "mapir" as const;
  readonly capabilities = MAPIR_CAPABILITIES;

  constructor(private readonly options: MapIrProviderOptions) {}

  private meta(): MapResultMeta {
    return { provider: "mapir", providerPlaceId: null, resolvedAt: new Date().toISOString() };
  }

  private get(operation: MapOperation, path: string, query: string): Promise<unknown> {
    return requestJson({
      provider: "mapir",
      operation,
      url: `${BASE_URL}${path}?${query}`,
      headers: { "x-api-key": this.options.apiKey },
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      // Map.ir documents no service-specific error codes beyond plain HTTP status
      // (see class doc comment) — no mapHttpError override, generic mapping applies.
    });
  }

  private assertCoordinates(operation: MapOperation, ...points: Coordinates[]) {
    if (!points.every(isValidCoordinates)) throw mapError("mapir", operation, "INVALID_REQUEST", "Invalid coordinates");
  }

  async reverseGeocode(coordinates: Coordinates): Promise<ReverseGeocodeResult> {
    this.assertCoordinates("reverseGeocode", coordinates);
    const body = await this.get("reverseGeocode", "/reverse/", `lat=${coordinates.latitude}&lon=${coordinates.longitude}`);
    if (!isRecord(body)) throw mapError("mapir", "reverseGeocode", "INVALID_RESPONSE");
    const data = body as MapIrReverseResponse;

    const formattedAddress = nonEmpty(data.address);
    if (!formattedAddress) throw mapError("mapir", "reverseGeocode", "NO_RESULT");

    const plaque = data.plaque === null || data.plaque === undefined || data.plaque === "" ? null : String(data.plaque);
    return {
      address: {
        province: nonEmpty(data.province),
        city: nonEmpty(data.city),
        // Map.ir's "region" is the municipal zone/district name — closest documented field to our `district`.
        district: nonEmpty(data.region),
        neighborhood: nonEmpty(data.neighborhood),
        street: nonEmpty(data.primary),
        plaque,
        // Map.ir's reverse response has no separate alley or unit field — explicit null, never guessed.
        alley: null,
        unit: null,
        postalCode: nonEmpty(data.postal_code),
        formattedAddress,
        coordinates,
      },
      meta: this.meta(),
    };
  }

  async geocode(_address: string): Promise<GeocodeResult[]> {
    void _address;
    throw unsupportedOperation("mapir", "geocode");
  }

  async searchPlaces(_query: string, _options?: SearchPlacesOptions): Promise<PlaceResult[]> {
    void _query;
    void _options;
    throw unsupportedOperation("mapir", "searchPlaces");
  }

  async getRoute(_origin: Coordinates, _destination: Coordinates, _options?: RouteOptions): Promise<RouteResult> {
    void _origin;
    void _destination;
    void _options;
    throw unsupportedOperation("mapir", "getRoute");
  }
}
