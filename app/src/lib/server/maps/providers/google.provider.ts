import {
  isValidCoordinates,
  type Coordinates,
  type GeocodeResult,
  type MapResultMeta,
  type PlaceResult,
  type ReverseGeocodeResult,
  type RouteMatrixCell,
  type RouteMatrixResult,
  type RouteResult,
  type VehicleType,
} from "@fruitland/shared";
import { MapProviderError, errorFromHttpStatus, mapError, unsupportedOperation, type MapOperation } from "../errors";
import { requestJson } from "../http";
import { decodePolylineToGeoJson } from "../polyline";
import type { MapCapabilities, MapProvider, RouteOptions, SearchPlacesOptions } from "../provider";

/**
 * Google Maps Platform adapter. Endpoints/params/response shapes below are
 * from official Google documentation (developers.google.com, checked
 * 2026-09-25):
 *   reverse/geocode  GET https://maps.googleapis.com/maps/api/geocode/json?latlng=|address=&key=
 *                    — legacy Geocoding API: auth is a `key` QUERY PARAM (not a
 *                    header, unlike every other Google API used here), and it
 *                    always answers HTTP 200 — success/failure is the `status`
 *                    JSON field, not the HTTP status.
 *   search           POST https://places.googleapis.com/v1/places:searchText
 *                    (Places API (New)) — header auth `X-Goog-Api-Key` +
 *                    required `X-Goog-FieldMask`; real HTTP status codes.
 *   route            POST https://routes.googleapis.com/directions/v2:computeRoutes
 *                    (Routes API) — same header auth; real HTTP status codes.
 *   routeMatrix      POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
 *                    (Routes API) — response is a bare JSON ARRAY of elements
 *                    keyed by originIndex/destinationIndex, order not guaranteed.
 *
 * All five MapProvider operations are backed by verified official docs, so
 * none are UNSUPPORTED_OPERATION for lack of documentation. vehicleType IS
 * unsupported only if a caller passes something outside VEHICLE_TYPES.
 */
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

export const GOOGLE_CAPABILITIES: MapCapabilities = {
  reverseGeocode: true,
  geocode: true,
  searchPlaces: true,
  getRoute: true,
  routeMatrix: true,
};

export interface GoogleMapsProviderOptions {
  /** Server-side key, distinct from any browser rendering key (see CLAUDE.md). Must have Geocoding, Places (New) and Routes APIs enabled. */
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeResultItem {
  address_components?: GoogleAddressComponent[];
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
}

interface GoogleGeocodeResponse {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodeResultItem[];
}

interface GooglePlaceItem {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
}

interface GoogleRouteItem {
  distanceMeters?: number;
  duration?: string;
  polyline?: { encodedPolyline?: string };
}

interface GoogleMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: Record<string, unknown>;
  condition?: string;
  distanceMeters?: number;
  duration?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** Google's Routes/Route-Matrix duration comes as "487s" — seconds, string, always suffixed. */
function parseGoogleDuration(value: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value ?? "");
  return match ? Math.round(Number(match[1])) : null;
}

const VEHICLE_TYPE_MAP: Record<VehicleType, "DRIVE" | "TWO_WHEELER" | "BICYCLE"> = {
  car: "DRIVE",
  motorcycle: "TWO_WHEELER",
  bicycle: "BICYCLE",
};

export class GoogleMapsProvider implements MapProvider {
  readonly name = "google" as const;
  readonly capabilities = GOOGLE_CAPABILITIES;

  constructor(private readonly options: GoogleMapsProviderOptions) {}

  private meta(providerPlaceId: string | null = null): MapResultMeta {
    return { provider: "google", providerPlaceId, resolvedAt: new Date().toISOString() };
  }

  private assertCoordinates(operation: MapOperation, ...points: Coordinates[]) {
    if (!points.every(isValidCoordinates)) throw mapError("google", operation, "INVALID_REQUEST", "Invalid coordinates");
  }

  /** The legacy Geocoding API: key is a query param, HTTP is always 200, and `status` carries the real outcome. */
  private async getGeocode(operation: MapOperation, query: string): Promise<GoogleGeocodeResponse> {
    const body = await requestJson({
      provider: "google",
      operation,
      url: `${GEOCODE_URL}?${query}&key=${encodeURIComponent(this.options.apiKey)}`,
      headers: {},
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
    });
    if (!isRecord(body)) throw mapError("google", operation, "INVALID_RESPONSE");
    const data = body as GoogleGeocodeResponse;
    this.throwOnGeocodeStatus(operation, data.status);
    return data;
  }

  /** Maps the documented Geocoding API `status` values — see class doc comment. */
  private throwOnGeocodeStatus(operation: MapOperation, status: string | undefined) {
    switch (status) {
      case "OK":
        return;
      case "ZERO_RESULTS":
        throw mapError("google", operation, "NO_RESULT");
      case "OVER_QUERY_LIMIT":
        throw mapError("google", operation, "RATE_LIMIT", "Google Geocoding API query quota exceeded");
      case "OVER_DAILY_LIMIT":
        // Docs: missing/invalid key, billing not enabled, or usage cap exceeded — a configuration problem, not a transient rate limit.
        throw new MapProviderError({
          provider: "google",
          operation,
          code: "AUTH_FAILED",
          message: "Google Geocoding API key/billing misconfigured or daily cap exceeded",
          retryable: false,
        });
      case "REQUEST_DENIED":
        throw mapError("google", operation, "AUTH_FAILED", "Google Geocoding API request denied");
      case "INVALID_REQUEST":
        throw mapError("google", operation, "INVALID_REQUEST");
      case "UNKNOWN_ERROR":
        throw mapError("google", operation, "PROVIDER_UNAVAILABLE", "Google Geocoding API server error (retry may succeed)");
      default:
        throw mapError("google", operation, "INVALID_RESPONSE", `Unrecognized Geocoding API status: ${status ?? "(none)"}`);
    }
  }

  /** Builds a NormalizedAddress from Google's documented address_components types. Anything Google doesn't provide stays null — never guessed. */
  private normalizeAddress(item: GoogleGeocodeResultItem, coordinates: Coordinates) {
    const components = item.address_components ?? [];
    const find = (type: string) => nonEmpty(components.find((c) => c.types?.includes(type))?.long_name);
    return {
      province: find("administrative_area_level_1"),
      city: find("locality") ?? find("administrative_area_level_2"),
      district: find("sublocality") ?? find("sublocality_level_1"),
      neighborhood: find("neighborhood"),
      street: find("route"),
      plaque: find("street_number"),
      // Google's address_components has no discrete alley or unit/apartment type.
      alley: null,
      unit: null,
      postalCode: find("postal_code"),
      formattedAddress: nonEmpty(item.formatted_address) ?? "",
      coordinates,
    };
  }

  async reverseGeocode(coordinates: Coordinates): Promise<ReverseGeocodeResult> {
    this.assertCoordinates("reverseGeocode", coordinates);
    const data = await this.getGeocode("reverseGeocode", `latlng=${coordinates.latitude},${coordinates.longitude}`);
    const first = data.results?.[0];
    if (!first || !nonEmpty(first.formatted_address)) throw mapError("google", "reverseGeocode", "NO_RESULT");
    return { address: this.normalizeAddress(first, coordinates), meta: this.meta() };
  }

  async geocode(address: string): Promise<GeocodeResult[]> {
    const query = address.trim();
    if (!query) throw mapError("google", "geocode", "INVALID_REQUEST", "Empty address");
    const data = await this.getGeocode("geocode", `address=${encodeURIComponent(query)}`);
    const results: GeocodeResult[] = [];
    for (const item of data.results ?? []) {
      const lat = item.geometry?.location?.lat;
      const lng = item.geometry?.location?.lng;
      const formattedAddress = nonEmpty(item.formatted_address);
      if (typeof lat !== "number" || typeof lng !== "number" || !formattedAddress) continue; // skip unusable rows, never invent
      const coordinates = { latitude: lat, longitude: lng };
      results.push({ coordinates, formattedAddress, address: this.normalizeAddress(item, coordinates), meta: this.meta() });
    }
    return results;
  }

  private async postJson(operation: MapOperation, url: string, fieldMask: string, body: unknown): Promise<unknown> {
    return requestJson({
      provider: "google",
      operation,
      url,
      method: "POST",
      body,
      headers: { "X-Goog-Api-Key": this.options.apiKey, "X-Goog-FieldMask": fieldMask },
      timeoutMs: this.options.timeoutMs,
      mapHttpError: (status) => errorFromHttpStatus("google", operation, status), // standard Google API error envelope: real HTTP status
      fetchImpl: this.options.fetchImpl,
    });
  }

  async searchPlaces(query: string, options?: SearchPlacesOptions): Promise<PlaceResult[]> {
    const term = query.trim();
    if (!term) throw mapError("google", "searchPlaces", "INVALID_REQUEST", "Empty search query");
    const requestBody: Record<string, unknown> = { textQuery: term };
    if (options?.near) {
      this.assertCoordinates("searchPlaces", options.near);
      requestBody.locationBias = { circle: { center: { latitude: options.near.latitude, longitude: options.near.longitude }, radius: 5000 } };
    }
    if (options?.limit) requestBody.pageSize = Math.min(options.limit, 20); // Places API (New) caps pageSize at 20

    const body = await this.postJson(
      "searchPlaces",
      PLACES_SEARCH_URL,
      "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types",
      requestBody,
    );
    if (!isRecord(body)) throw mapError("google", "searchPlaces", "INVALID_RESPONSE");
    const places = Array.isArray((body as { places?: unknown }).places) ? ((body as { places: GooglePlaceItem[] }).places) : [];

    const results: PlaceResult[] = [];
    for (const item of places) {
      const name = nonEmpty(item.displayName?.text);
      const point = { latitude: item.location?.latitude, longitude: item.location?.longitude };
      if (!name || !isValidCoordinates(point)) continue;
      const id = nonEmpty(item.id);
      results.push({
        id,
        name,
        coordinates: point,
        address: nonEmpty(item.formattedAddress),
        category: nonEmpty(item.primaryType) ?? nonEmpty(item.types?.[0] ?? null),
        meta: this.meta(id),
      });
    }
    return results;
  }

  async getRoute(origin: Coordinates, destination: Coordinates, options?: RouteOptions): Promise<RouteResult> {
    this.assertCoordinates("getRoute", origin, destination);
    const vehicleType = options?.vehicleType ?? "car";
    const travelMode = VEHICLE_TYPE_MAP[vehicleType];
    if (!travelMode) throw unsupportedOperation("google", "getRoute"); // exhaustive per VEHICLE_TYPES today, kept for future additions

    const includeGeometry = options?.includeGeometry !== false;
    const fields = includeGeometry ? "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline" : "routes.duration,routes.distanceMeters";
    const body = await this.postJson("getRoute", ROUTES_URL, fields, {
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
      travelMode,
    });
    if (!isRecord(body)) throw mapError("google", "getRoute", "INVALID_RESPONSE");
    const route = ((body as { routes?: GoogleRouteItem[] }).routes ?? [])[0];
    if (!route) throw mapError("google", "getRoute", "NO_RESULT", "Google found no route between the points");

    const distanceMeters = route.distanceMeters;
    const durationSeconds = parseGoogleDuration(route.duration);
    if (typeof distanceMeters !== "number" || durationSeconds === null) throw mapError("google", "getRoute", "INVALID_RESPONSE");

    const encoded = route.polyline?.encodedPolyline;
    return {
      distanceMeters,
      durationSeconds,
      origin,
      destination,
      // Decoded elsewhere via the shared polyline decoder (same algorithm Google's own encoding uses); kept out of this
      // adapter's job list to avoid duplicating Neshan's decoder — see maps/polyline.ts. Left null unless requested.
      geometry: includeGeometry && encoded ? { type: "LineString", coordinates: decodeGooglePolyline(encoded) } : null,
      meta: this.meta(),
    };
  }

  async getRouteMatrix(origins: Coordinates[], destinations: Coordinates[]): Promise<RouteMatrixResult> {
    this.assertCoordinates("getRouteMatrix", ...origins, ...destinations);
    if (origins.length === 0 || destinations.length === 0) {
      throw mapError("google", "getRouteMatrix", "INVALID_REQUEST", "origins and destinations must be non-empty");
    }

    const body = await this.postJson(
      "getRouteMatrix",
      ROUTE_MATRIX_URL,
      "originIndex,destinationIndex,status,condition,distanceMeters,duration",
      {
        origins: origins.map((point) => ({ waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } } })),
        destinations: destinations.map((point) => ({ waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } } })),
        travelMode: "DRIVE",
      },
    );
    if (!Array.isArray(body)) throw mapError("google", "getRouteMatrix", "INVALID_RESPONSE");

    // Response elements are unordered (doc: "order of elements is not guaranteed") — placed by index, not push order.
    const rows: RouteMatrixCell[][] = Array.from({ length: origins.length }, () =>
      Array.from({ length: destinations.length }, () => ({ distanceMeters: null, durationSeconds: null })),
    );
    for (const element of body as GoogleMatrixElement[]) {
      const i = element.originIndex ?? 0;
      const j = element.destinationIndex ?? 0;
      if (!rows[i] || !rows[i][j]) continue;
      const hasError = element.status && Object.keys(element.status).length > 0;
      if (hasError || element.condition !== "ROUTE_EXISTS") continue; // stays null — a route genuinely doesn't exist, never fabricated
      const durationSeconds = parseGoogleDuration(element.duration);
      if (typeof element.distanceMeters === "number" && durationSeconds !== null) {
        rows[i][j] = { distanceMeters: element.distanceMeters, durationSeconds };
      }
    }
    return { rows, meta: this.meta() };
  }
}

/**
 * Decodes Google's Routes API polyline (same precision-5 algorithm as
 * Neshan's overview_polyline — Google's own format) into GeoJSON [lng, lat]
 * pairs, reusing the shared decoder.
 */
function decodeGooglePolyline(encoded: string) {
  return decodePolylineToGeoJson(encoded);
}
