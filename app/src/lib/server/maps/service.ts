import type {
  Coordinates,
  GeocodeResult,
  MapProviderName,
  PlaceResult,
  ReverseGeocodeResult,
  RouteMatrixResult,
  RouteResult,
} from "@fruitland/shared";
import { getEnv } from "../env";
import { MapProviderError, unsupportedOperation, type MapOperation } from "./errors";
import type { MapCapability, MapProvider, RouteOptions, SearchPlacesOptions } from "./provider";
import { getDefaultMapProvider, getMapProvider } from "./registry";

/** Maps each MapService operation name to the capability flag that governs it (they differ once: getRouteMatrix ↔ routeMatrix). */
const OPERATION_CAPABILITY: Record<MapOperation, MapCapability> = {
  reverseGeocode: "reverseGeocode",
  geocode: "geocode",
  searchPlaces: "searchPlaces",
  getRoute: "getRoute",
  getRouteMatrix: "routeMatrix",
};

function supports(provider: MapProvider, operation: MapOperation): boolean {
  return provider.capabilities[OPERATION_CAPABILITY[operation]];
}

/**
 * Application-level facade over the provider layer. Owns the two
 * cross-provider policies that must not be duplicated inside each adapter:
 *
 *   retry    — bounded, same-provider retries for errors the provider itself
 *              marked `retryable` (MapProviderError, see errors.ts).
 *   fallback — after retries are exhausted, if the error is `fallbackEligible`
 *              (TIMEOUT/NETWORK/PROVIDER_UNAVAILABLE only — never auth,
 *              validation, unsupported-operation, or a non-retryable rate
 *              limit), try a single configured fallback provider once — but
 *              only if it actually declares support for that operation.
 *
 * MapService never imports a concrete provider class; it only holds already
 * resolved `MapProvider` instances (see `createMapService` below, which is the
 * only place that talks to the Registry/env). This makes the policy logic
 * itself trivially testable with FakeMapProvider, with no env/registry mocking.
 */
export class MapService {
  constructor(
    private readonly primary: MapProvider,
    /** null means "no usable fallback" — already resolved not-configured / same-as-primary at construction time. */
    private readonly fallback: MapProvider | null,
    /** Extra attempts AFTER the first try, against the SAME provider. 0 = no retries. */
    private readonly maxRetries: number,
  ) {}

  reverseGeocode(coordinates: Coordinates): Promise<ReverseGeocodeResult> {
    return this.execute("reverseGeocode", (p) => p.reverseGeocode(coordinates));
  }

  geocode(address: string): Promise<GeocodeResult[]> {
    return this.execute("geocode", (p) => p.geocode(address));
  }

  searchPlaces(query: string, options?: SearchPlacesOptions): Promise<PlaceResult[]> {
    return this.execute("searchPlaces", (p) => p.searchPlaces(query, options));
  }

  getRoute(origin: Coordinates, destination: Coordinates, options?: RouteOptions): Promise<RouteResult> {
    return this.execute("getRoute", (p) => p.getRoute(origin, destination, options));
  }

  getRouteMatrix(origins: Coordinates[], destinations: Coordinates[]): Promise<RouteMatrixResult> {
    return this.execute("getRouteMatrix", (p) => {
      if (!p.getRouteMatrix) throw unsupportedOperation(p.name, "getRouteMatrix");
      return p.getRouteMatrix(origins, destinations);
    });
  }

  /** Runs one operation against the primary with retry, then — only if genuinely eligible — once against the fallback. */
  private async execute<T>(operation: MapOperation, call: (provider: MapProvider) => Promise<T>): Promise<T> {
    try {
      return await this.attempt(() => call(this.primary));
    } catch (err) {
      if (!this.canFallBackFrom(err) || !this.fallback) throw err;
      if (!supports(this.fallback, operation)) throw err; // never pretend the fallback has a capability it doesn't
      // The fallback gets the same bounded retry policy, then its own failure (if any) is what the caller sees.
      return this.attempt(() => call(this.fallback as MapProvider));
    }
  }

  private canFallBackFrom(err: unknown): err is MapProviderError {
    return err instanceof MapProviderError && err.fallbackEligible;
  }

  /** Initial call + up to `maxRetries` more, but only while the error is marked retryable; stops immediately otherwise. */
  private async attempt<T>(call: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attemptNumber = 0; attemptNumber <= this.maxRetries; attemptNumber++) {
      try {
        return await call();
      } catch (err) {
        lastError = err;
        if (!(err instanceof MapProviderError) || !err.retryable) throw err;
      }
    }
    throw lastError;
  }
}

/**
 * The only place MapService talks to the Registry/env. Resolves the primary
 * (default, or an explicit override for callers that need a specific
 * provider) and the configured fallback, applying the two safety rules that
 * must happen before any request is made:
 *   - an unconfigured fallback (MAP_FALLBACK_PROVIDER="") means no fallback;
 *   - a fallback equal to the primary is not a real fallback and is dropped,
 *     rather than silently retrying the same provider "twice".
 * Resolution failures (e.g. the fallback provider is configured but its
 * credential is missing) are NOT swallowed here — a configured-but-broken
 * fallback is a configuration error and must fail loudly, not hide behind
 * fallback behavior.
 */
export function createMapService(overrides?: { provider?: MapProviderName }): MapService {
  const env = getEnv();
  const primary = overrides?.provider ? getMapProvider(overrides.provider) : getDefaultMapProvider();
  const fallbackName = env.MAP_FALLBACK_PROVIDER || null;
  const fallback = fallbackName && fallbackName !== primary.name ? getMapProvider(fallbackName) : null;
  return new MapService(primary, fallback, env.MAP_MAX_RETRIES);
}
