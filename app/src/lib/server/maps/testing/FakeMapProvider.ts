import type { Coordinates, MapProviderName, ReverseGeocodeResult } from "@fruitland/shared";
import { mapError } from "../errors";
import type { MapCapabilities, MapProvider } from "../provider";

const meta = (provider: MapProviderName) => ({ provider, providerPlaceId: null, resolvedAt: "2026-01-01T00:00:00.000Z" });

/**
 * Deterministic in-memory provider for unit/integration tests (never used at
 * runtime). Every call is recorded in `calls`; `failWith` makes the next
 * call(s) throw a normalized error so retry/fallback logic can be tested.
 */
export class FakeMapProvider implements MapProvider {
  readonly calls: { operation: string; args: unknown[] }[] = [];
  failWith: ReturnType<typeof mapError> | null = null;

  constructor(
    readonly name: MapProviderName = "neshan",
    readonly capabilities: MapCapabilities = {
      reverseGeocode: true,
      geocode: true,
      searchPlaces: true,
      getRoute: true,
      routeMatrix: false,
    },
  ) {}

  private record(operation: string, args: unknown[]) {
    this.calls.push({ operation, args });
    if (this.failWith) throw this.failWith;
  }

  async reverseGeocode(coordinates: Coordinates): Promise<ReverseGeocodeResult> {
    this.record("reverseGeocode", [coordinates]);
    return {
      address: {
        province: "زنجان",
        city: "زنجان",
        district: null,
        neighborhood: null,
        street: null,
        alley: null,
        plaque: null,
        unit: null,
        postalCode: null,
        formattedAddress: `fake:${this.name}:${coordinates.latitude},${coordinates.longitude}`,
        coordinates,
      },
      meta: meta(this.name),
    };
  }

  async geocode(address: string) {
    this.record("geocode", [address]);
    return [
      {
        coordinates: { latitude: 36.6769, longitude: 48.4963 },
        formattedAddress: address,
        address: null,
        meta: meta(this.name),
      },
    ];
  }

  async searchPlaces(query: string, options?: Parameters<MapProvider["searchPlaces"]>[1]) {
    this.record("searchPlaces", [query, options]);
    return [
      {
        id: null,
        name: query,
        coordinates: { latitude: 36.6769, longitude: 48.4963 },
        address: null,
        category: null,
        meta: meta(this.name),
      },
    ];
  }

  async getRoute(origin: Coordinates, destination: Coordinates, options?: Parameters<MapProvider["getRoute"]>[2]) {
    this.record("getRoute", [origin, destination, options]);
    return {
      distanceMeters: 4200,
      durationSeconds: 780,
      origin,
      destination,
      geometry: null,
      meta: meta(this.name),
    };
  }
}
