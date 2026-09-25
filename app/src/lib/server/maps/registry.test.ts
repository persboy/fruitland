import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshRegistry() {
  vi.resetModules();
  return import("./registry");
}

describe("map provider registry", () => {
  beforeEach(() => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/fruitland_test");
    vi.stubEnv("JWT_ACCESS_SECRET", "test-access-secret");
    vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves each of the three stable identifiers to the matching provider instance", async () => {
    vi.stubEnv("NESHAN_API_KEY", "neshan-key");
    vi.stubEnv("MAPIR_API_KEY", "mapir-key");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    const { getMapProvider } = await freshRegistry();
    const { NeshanProvider } = await import("./providers/neshan.provider");
    const { MapIrProvider } = await import("./providers/mapir.provider");
    const { GoogleMapsProvider } = await import("./providers/google.provider");

    const neshan = getMapProvider("neshan");
    const mapir = getMapProvider("mapir");
    const google = getMapProvider("google");
    expect(neshan).toBeInstanceOf(NeshanProvider);
    expect(neshan.name).toBe("neshan");
    expect(mapir).toBeInstanceOf(MapIrProvider);
    expect(mapir.name).toBe("mapir");
    expect(google).toBeInstanceOf(GoogleMapsProvider);
    expect(google.name).toBe("google");
  });

  it("preserves each provider's real capability matrix — never fakes symmetry", async () => {
    vi.stubEnv("NESHAN_API_KEY", "neshan-key");
    vi.stubEnv("MAPIR_API_KEY", "mapir-key");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    const { getMapProvider } = await freshRegistry();
    expect(getMapProvider("neshan").capabilities).toEqual({ reverseGeocode: true, geocode: false, searchPlaces: true, getRoute: true, routeMatrix: false });
    expect(getMapProvider("mapir").capabilities).toEqual({ reverseGeocode: true, geocode: false, searchPlaces: false, getRoute: false, routeMatrix: false });
    expect(getMapProvider("google").capabilities).toEqual({ reverseGeocode: true, geocode: true, searchPlaces: true, getRoute: true, routeMatrix: true });
  });

  it("reuses the same instance across calls (stateless providers, no needless reconstruction)", async () => {
    vi.stubEnv("NESHAN_API_KEY", "neshan-key");
    const { getMapProvider } = await freshRegistry();
    expect(getMapProvider("neshan")).toBe(getMapProvider("neshan"));
  });

  it("getDefaultMapProvider follows MAP_PROVIDER, not a hard-coded name", async () => {
    vi.stubEnv("MAP_PROVIDER", "google");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-key");
    const { getDefaultMapProvider } = await freshRegistry();
    const { GoogleMapsProvider } = await import("./providers/google.provider");
    expect(getDefaultMapProvider()).toBeInstanceOf(GoogleMapsProvider);
  });

  it("an invalid MAP_PROVIDER fails at env validation, before the registry is even asked", async () => {
    vi.stubEnv("MAP_PROVIDER", "bing");
    const { getDefaultMapProvider } = await freshRegistry();
    expect(() => getDefaultMapProvider()).toThrow(/MAP_PROVIDER/);
  });

  it("a missing credential for the requested provider throws a clear, specific error (not a generic MapProviderError)", async () => {
    // GOOGLE_MAPS_API_KEY intentionally left unset.
    const { getMapProvider } = await freshRegistry();
    expect(() => getMapProvider("google")).toThrow(/google.*GOOGLE_MAPS_API_KEY/i);
  });

  it("a missing credential for one provider does not block resolving another (comparison-mode friendly)", async () => {
    vi.stubEnv("NESHAN_API_KEY", "neshan-key");
    // MAPIR_API_KEY intentionally left unset.
    const { getMapProvider } = await freshRegistry();
    expect(() => getMapProvider("neshan")).not.toThrow();
    expect(() => getMapProvider("mapir")).toThrow(/mapir.*MAPIR_API_KEY/i);
  });

  it("resetMapProviderRegistryForTests clears the cache so a new instance is built next time", async () => {
    vi.stubEnv("NESHAN_API_KEY", "neshan-key");
    const { getMapProvider, resetMapProviderRegistryForTests } = await freshRegistry();
    const first = getMapProvider("neshan");
    resetMapProviderRegistryForTests();
    const second = getMapProvider("neshan");
    expect(second).not.toBe(first);
  });
});
