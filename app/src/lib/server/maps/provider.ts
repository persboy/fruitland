import type {
  Coordinates,
  GeocodeResult,
  MapProviderName,
  PlaceResult,
  ReverseGeocodeResult,
  RouteMatrixResult,
  RouteResult,
} from "@fruitland/shared";

/** What a provider can do. Declared honestly per adapter from its official docs — never assumed. */
export const MAP_CAPABILITIES = ["reverseGeocode", "geocode", "searchPlaces", "getRoute", "routeMatrix"] as const;
export type MapCapability = (typeof MAP_CAPABILITIES)[number];
export type MapCapabilities = Record<MapCapability, boolean>;

export interface SearchPlacesOptions {
  /** Bias results toward this point (e.g. the store or the map centre). */
  near?: Coordinates;
  /** Upper bound on returned results; the service applies a default. */
  limit?: number;
}

export interface RouteOptions {
  /** Ask for the line geometry. Default true; pass false to save payload when only distance/time are needed. */
  includeGeometry?: boolean;
}

export interface GeocodingProvider {
  /** Throws MapProviderError(NO_RESULT) when nothing is found at the point. */
  reverseGeocode(coordinates: Coordinates): Promise<ReverseGeocodeResult>;
  /** Empty array when nothing matches. */
  geocode(address: string): Promise<GeocodeResult[]>;
}

export interface PlacesProvider {
  /** Empty array when nothing matches. */
  searchPlaces(query: string, options?: SearchPlacesOptions): Promise<PlaceResult[]>;
}

export interface RoutingProvider {
  getRoute(origin: Coordinates, destination: Coordinates, options?: RouteOptions): Promise<RouteResult>;
  /** Optional capability: only present/usable when `capabilities.routeMatrix` is true and MAP_ENABLE_ROUTE_MATRIX is on. */
  getRouteMatrix?(origins: Coordinates[], destinations: Coordinates[]): Promise<RouteMatrixResult>;
}

/**
 * The single contract every provider adapter implements. Business code never
 * sees a concrete adapter — only MapService does. An operation the provider
 * does not support must throw `unsupportedOperation(...)` AND be reported
 * `false` in `capabilities`, so callers can check instead of catching.
 */
export interface MapProvider extends GeocodingProvider, PlacesProvider, RoutingProvider {
  readonly name: MapProviderName;
  readonly capabilities: MapCapabilities;
}
